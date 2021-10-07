import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as eks from '@pulumi/eks';
import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as kx from '@pulumi/kubernetesx';
import { Config } from '@pulumi/pulumi';
import * as random from '@pulumi/random';

const config = new Config();

// Create a new VPC for the cluster.
const vpc = new awsx.ec2.Vpc('aitomatic-eks-vpc', {
  numberOfAvailabilityZones: 'all',
  tags: {
    managedBy: 'aitomatic'
  }
});

// IAM roles for the node group.
const role = new aws.iam.Role('aitomatic-eks-ng-role', {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'ec2.amazonaws.com'
  }),
  tags: {
    managedBy: 'aitomatic'
  }
});
let counter = 0;
for (const policyArn of [
  'arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy',
  'arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy',
  'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly'
]) {
  new aws.iam.RolePolicyAttachment(
    `aitomatic-eks-ng-role-policy-${counter++}`,
    { policyArn, role }
  );
}

// Create the EKS cluster itself with Fargate enabled.
const cluster = new eks.Cluster('aitomatic-eks-cluster', {
  skipDefaultNodeGroup: true,
  vpcId: vpc.id,
  privateSubnetIds: vpc.privateSubnetIds,
  publicSubnetIds: vpc.publicSubnetIds,
  nodeAssociatePublicIpAddress: true,
  createOidcProvider: true,
  enabledClusterLogTypes: [
    'api',
    'audit',
    'authenticator',
    'controllerManager',
    'scheduler'
  ],
  tags: {
    managedBy: 'aitomatic'
  },
  instanceRoles: [role],
  providerCredentialOpts: {
    profileName: config.get('aws:profile')
  }
});

// Create a simple AWS managed node group using a cluster as input.
const managedNodeGroup = eks.createManagedNodeGroup(
  'aitomatic-eks-ng',
  {
    cluster: cluster,
    nodeGroupName: 'aitomatic-eks-ng1',
    nodeRoleArn: role.arn,
    labels: { ondemand: 'true' },
    tags: { org: 'pulumi', managedBy: 'aitomatic' },

    scalingConfig: {
      minSize: 2,
      maxSize: 20,
      desiredSize: 2
    }
  },
  cluster
);

// Export the cluster's kubeconfig.
export const kubeconfig = cluster.kubeconfig;

const aiSystemNs = new k8s.core.v1.Namespace(
  'aitomatic-system',
  { metadata: { labels: { 'istio-injection': 'enabled' } } },
  { dependsOn: [cluster], provider: cluster.provider }
);
const aiInfraNs = new k8s.core.v1.Namespace(
  'aitomatic-infra',
  { metadata: { labels: { 'istio-injection': 'enabled' } } },
  { dependsOn: [cluster], provider: cluster.provider }
);
const aiAppsNs = new k8s.core.v1.Namespace(
  'aitomatic-apps',
  { metadata: { labels: { 'istio-injection': 'enabled' } } },
  { dependsOn: [cluster], provider: cluster.provider }
);

/*const autoScalerRole = new Role("aitomatic-autoscaler", {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal
})*/

// Deploy metrics-server from Bitnami Helm Repo to aitomatic-system Namespace
const metricsServerChart = new k8s.helm.v3.Chart(
  'aisys-ms',
  {
    version: '5.10.4',
    chart: 'metrics-server',
    namespace: aiSystemNs.id,
    fetchOpts: {
      repo: 'https://charts.bitnami.com/bitnami'
    }
  },
  { dependsOn: [cluster, aiSystemNs], provider: cluster.provider }
);

// Deploy autoscaler from K8s Helm Repo to aitomatic-system Namespace
const autoScalerChart = new k8s.helm.v3.Chart(
  'aisys-as',
  {
    version: '9.10.7',
    chart: 'cluster-autoscaler',
    namespace: aiSystemNs.id,
    fetchOpts: {
      repo: 'https://kubernetes.github.io/autoscaler'
    }
  },
  { dependsOn: [cluster, aiSystemNs], provider: cluster.provider }
);

// Setup Istio
const aiIstioNs = new k8s.core.v1.Namespace(
  'istio-system',
  { metadata: { name: 'istio-system' } },
  { provider: cluster.provider }
);

new k8s.rbac.v1.ClusterRoleBinding(
  'cluster-admin-binding',
  {
    metadata: { name: 'cluster-admin-binding' },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'ClusterRole',
      name: 'cluster-admin'
    },
    subjects: [
      {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'User',
        name: config.get('username') || 'admin'
      }
    ]
  },
  { dependsOn: [cluster], provider: cluster.provider }
);

const istio = new k8s.helm.v3.Chart(
  'aisys-istio',
  {
    chart: 'istio',
    namespace: aiIstioNs.id,
    version: '1.11.1',
    // for all options check https://github.com/istio/istio/tree/master/install/kubernetes/helm/istio
    values: { kiali: { enabled: true } },
    fetchOpts: {
      repo: 'https://getindata.github.io/helm-charts/'
    }
  },
  {
    dependsOn: [aiIstioNs, cluster],
    providers: { kubernetes: cluster.provider }
  }
);

const kiali = new k8s.helm.v3.Chart(
  'aisys-kiali',
  {
    chart: 'kiali-server',
    namespace: aiIstioNs.id,
    fetchOpts: {
      repo: 'https://kiali.org/helm-charts/'
    }
  },
  { dependsOn: [istio, cluster], providers: { kubernetes: cluster.provider } }
);

// Create PostgreSQL database for System
const dbPassword = new random.RandomPassword('aitomatic-system-db-password', {
  length: 16,
  special: false
});

const dbSubnetGroup = new aws.rds.SubnetGroup('aitomatic-db-sn', {
  subnetIds: vpc.privateSubnetIds,
  tags: {
    Name: 'RDS Subnet Group',
    managedBy: 'aitomatic'
  }
});

const db = new aws.rds.Instance('aitomatic-db', {
  allocatedStorage: 10,
  maxAllocatedStorage: 100,
  engine: 'postgres',
  engineVersion: '11.10',
  instanceClass: 'db.t3.medium',
  password: dbPassword.result,
  skipFinalSnapshot: true,
  vpcSecurityGroupIds: [
    cluster.clusterSecurityGroup.id,
    cluster.nodeSecurityGroup.id
  ],
  username: 'postgres',
  dbSubnetGroupName: dbSubnetGroup.name
});

//Put DB Secrets in Infra Namespace
const secretInfra = new kx.Secret(
  'aitomatic-infradb-secrets',
  {
    stringData: {
      'aitomatic-db-user': db.username,
      'aitomatic-db-password': db.password,
      'aitomatic-db-host': db.address,
      'aitomatic-db-port': db.port.apply((x) => `x`),
      'aitomatic-db-dbname': db.id
    },
    metadata: {
      namespace: aiInfraNs.id
    }
  },
  { dependsOn: [cluster], provider: cluster.provider }
);

//Put DB Secrets in Apps Namespace
const secretApps = new kx.Secret(
  'aitomatic-appsdb-secrets',
  {
    stringData: {
      'aitomatic-db-user': db.username,
      'aitomatic-db-password': db.password,
      'aitomatic-db-host': db.address,
      'aitomatic-db-port': db.port.apply((p) => `${p}`),
      'aitomatic-db-dbname': db.name
    },
    metadata: {
      namespace: aiAppsNs.id
    }
  },
  { dependsOn: [cluster], provider: cluster.provider }
);

const seldonChart = new k8s.helm.v3.Chart(
  'aiinfra-seldon',
  {
    chart: 'seldon-core-operator',
    version: '0.2.8-SNAPSHOT',
    namespace: aiInfraNs.id,
    fetchOpts: {
      repo: 'https://storage.googleapis.com/seldon-charts/'
    },
    values: {
      'istio.enabled': true,
      'usageMetrics.enabled': true,
      'istio.gateway': 'istio-ingressgateway'
    }
  },
  { dependsOn: [cluster, istio], providers: { kubernetes: cluster.provider } }
);
