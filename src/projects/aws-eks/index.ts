import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as eks from '@pulumi/eks';
import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as kx from '@pulumi/kubernetesx';
import { Config, Output } from '@pulumi/pulumi';
import * as random from '@pulumi/random';
import * as identity from './identity';

const awsConfig = new Config('aws');
const jxConfig = new Config('jx');
const aiConfig = new Config('ai');
const githubConfig = new Config('github');

const kubeSystemNamespace = 'kube-system';
const pulumiStack = pulumi.getStack();

const awsRegion = awsConfig.get('region');

const aiParentZone = aiConfig.get('parentzone');

const jxGitUrl = jxConfig.get('giturl');
const jsGitUsername = jxConfig.get('gitusername');
const jxGitToken = jxConfig.getSecret('gittoken');

const githubClientId = githubConfig.get('clientid');
const githubClientSecret = githubConfig.getSecret('clientsecret');
const githubOrgs = githubConfig.getObject('orgs');

// Create a new VPC for the cluster.
const vpc = new awsx.ec2.Vpc(`ai-eks-vpc-${pulumiStack}`, {
  numberOfNatGateways: 1,
  tags: {
    managedBy: 'aitomatic',
    stack: pulumiStack,
    Name: `ai-eks-vpc-${pulumiStack}`
  }
});

const ecrPolicy = new aws.iam.Policy(`${pulumiStack}-ecrcreate-policy`, {
  description: pulumi.interpolate`External DNS policy for ${pulumiStack}`,
  policy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['ecr:CreateRepository', 'ecr:PutLifecyclePolicy'],
        Resource: ['*']
      }
    ]
  })
});

// IAM roles for the node group
const role = new aws.iam.Role(`ai-eks-ngrole-${pulumiStack}`, {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'ec2.amazonaws.com'
  }),
  tags: {
    managedBy: 'aitomatic',
    stack: pulumiStack
  }
});
let counter = 0;
for (const policyArn of [
  'arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy',
  'arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy',
  'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
  'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser',
  ecrPolicy.arn
]) {
  new aws.iam.RolePolicyAttachment(
    `ai-eks-ngrole-policy-${pulumiStack}-${counter++}`,
    { policyArn, role }
  );
}

// Create the EKS cluster itself without default node group.
const cluster = new eks.Cluster(`ai-eks-cluster-${pulumiStack}`, {
  skipDefaultNodeGroup: true,
  vpcId: vpc.id,
  privateSubnetIds: vpc.privateSubnetIds,
  publicSubnetIds: vpc.publicSubnetIds,
  nodeAssociatePublicIpAddress: false,
  deployDashboard: false,
  createOidcProvider: true,
  enabledClusterLogTypes: [
    'api',
    'audit',
    'authenticator',
    'controllerManager',
    'scheduler'
  ],
  tags: {
    managedBy: 'aitomatic',
    stack: pulumiStack
  },
  instanceRoles: [role],
  roleMappings: [
    {
      roleArn: identity.adminsIamRoleArn,
      groups: ['system:masters'],
      username: 'pulumi:admins'
    },
    {
      roleArn: identity.devsIamRoleArn,
      groups: ['pulumi:devs'],
      username: 'pulumi:alice'
    }
  ],
  providerCredentialOpts: {
    profileName: awsConfig.get('profile')
  }
});

// Export the cluster's kubeconfig.
export const kubeconfig = cluster.kubeconfig;

//Export profile to add to ~/.aws/config
export const awsProfileSnippet = pulumi.interpolate`
[profile ${pulumiStack}]
region = ${awsRegion}
output = json
role_arn = ${identity.adminsIamRoleArn}
source_profile = default
`;

//Export commands to setup KUBECONFIG
export const kubeConfigSetup = `
$ pulumi stack output kubeconfig > kubeconfig-${pulumiStack}
$ export KUBECONFIG=\`pwd\`/kubeconfig-${pulumiStack}
`;

const clusterOidcProvider = cluster.core.oidcProvider;
const clusterOidcProviderUrl = clusterOidcProvider.url;
const clusterOidcArn = clusterOidcProvider.arn;

// Create PostgreSQL database for System
const dbPassword = new random.RandomPassword('aitomatic-system-db-password', {
  length: 16,
  special: false
});

const dbSubnetGroup = new aws.rds.SubnetGroup(`ai-db-sn-${pulumiStack}`, {
  subnetIds: vpc.privateSubnetIds,
  tags: {
    Name: 'RDS Subnet Group',
    managedBy: 'aitomatic',
    stack: pulumiStack
  }
});

const db = new aws.rds.Instance(`aidb-${pulumiStack}`, {
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
  dbSubnetGroupName: dbSubnetGroup.name,
  tags: {
    managedBy: 'aitomatic',
    stack: pulumiStack
  }
});

// Create a simple AWS managed node group using a cluster as input.
const defaultAsgMin = 6;
const defaultAsgMax = 30;
const defaultAsgDesired = 6;

const managedNodeGroup = eks.createManagedNodeGroup(
  `ai-eks-mng-${pulumiStack}`,
  {
    cluster: cluster,
    nodeGroupName: `ai-eks-mng-${pulumiStack}`,
    nodeRoleArn: role.arn,
    labels: { ondemand: 'true' },
    tags: {
      org: 'pulumi',
      managedBy: 'aitomatic',
      stack: `${pulumiStack}`
    },
    scalingConfig: {
      minSize: defaultAsgMin,
      maxSize: defaultAsgMax,
      desiredSize: defaultAsgDesired
    },
    instanceTypes: ['t3a.large'],
    diskSize: 40
  },
  cluster
);

const ednsAssumeRolePolicy = pulumi
  .all([clusterOidcProviderUrl, clusterOidcArn])
  .apply(([url, arn]) =>
    aws.iam.getPolicyDocument({
      statements: [
        {
          effect: 'Allow',
          principals: [
            {
              identifiers: [arn],
              type: 'Federated'
            }
          ],
          actions: ['sts:AssumeRoleWithWebIdentity'],
          conditions: [
            {
              test: 'StringLike',
              values: ['system:serviceaccount:kube-system:*'],
              variable: `${url}:sub`
            }
          ]
        }
      ]
    })
  );

const ednsRole = new aws.iam.Role(`${pulumiStack}-edns`, {
  assumeRolePolicy: ednsAssumeRolePolicy.json
});

const ednsPolicy = new aws.iam.Policy(`${pulumiStack}-edns-policy`, {
  description: pulumi.interpolate`External DNS policy for ${cluster.eksCluster.id}`,
  policy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'route53:GetHostedZone',
          'route53:ListHostedZonesByName',
          'route53:CreateHostedZone',
          'route53:DeleteHostedZone',
          'route53:ChangeResourceRecordSets',
          'route53:CreateHealthCheck',
          'route53:GetHealthCheck',
          'route53:DeleteHealthCheck',
          'route53:UpdateHealthCheck',
          'ec2:DescribeVpcs',
          'ec2:DescribeRegions',
          'servicediscovery:*'
        ],
        Resource: ['*']
      }
    ]
  })
});

new aws.iam.RolePolicyAttachment(`${pulumiStack}-edns-role-attach-policy`, {
  policyArn: ednsPolicy.arn,
  role: ednsRole.name
});

const clientEnvDomain = `${pulumiStack}.${aiParentZone}`;

const ednsPublicCloudMapNs = new aws.servicediscovery.PublicDnsNamespace(
  `${pulumiStack}-public-external-dns`,
  {
    name: clientEnvDomain,
    description: `Cloud Map Namespace to support External DNS for ${pulumiStack}`,
    tags: {
      managedBy: 'aitomatic',
      stack: pulumiStack
    }
  }
);

const parentZone = aws.route53.getZone({ name: aiParentZone });
const ednsHostedZone = ednsPublicCloudMapNs.hostedZone.apply((ehz) =>
  aws.route53.getZone({ zoneId: ehz })
);

const ednsNsRecord = new aws.route53.Record(`${pulumiStack}-edns-ns-record`, {
  allowOverwrite: true,
  name: clientEnvDomain,
  ttl: 8600,
  type: 'NS',
  zoneId: parentZone.then((z) => z.id),
  records: [
    ednsHostedZone.nameServers[0],
    ednsHostedZone.nameServers[1],
    ednsHostedZone.nameServers[2],
    ednsHostedZone.nameServers[3]
  ]
});

const ednsPrivateCloudMapNs = new aws.servicediscovery.PrivateDnsNamespace(
  `${pulumiStack}-private-external-dns`,
  {
    name: `private.${clientEnvDomain}`,
    description: `Cloud Map Namespace to support External DNS for ${pulumiStack}`,
    vpc: vpc.id,
    tags: {
      managedBy: 'aitomatic',
      stack: pulumiStack
    }
  }
);

const ednsSA = new k8s.core.v1.ServiceAccount(
  'external-dns-sa',
  {
    metadata: {
      name: 'external-dns',
      namespace: kubeSystemNamespace,
      annotations: {
        'eks.amazonaws.com/role-arn': ednsRole.arn
      }
    }
  },
  {
    dependsOn: [cluster, managedNodeGroup],
    provider: cluster.provider
  }
);

const ednsClusterRole = new k8s.rbac.v1.ClusterRole(
  'external-dns-cr',
  {
    metadata: { name: 'external-dns' },
    rules: [
      {
        apiGroups: [''],
        resources: ['services', 'endpoints', 'pods'],
        verbs: ['get', 'watch', 'list']
      },
      {
        apiGroups: ['extensions', 'networking.k8s.io'],
        resources: ['ingresses'],
        verbs: ['get', 'watch', 'list']
      },
      {
        apiGroups: [''],
        resources: ['nodes'],
        verbs: ['get', 'watch', 'list']
      },
      {
        apiGroups: ['networking.istio.io'],
        resources: ['gateways', 'virtualservices'],
        verbs: ['get', 'watch', 'list']
      }
    ]
  },
  {
    dependsOn: [cluster, managedNodeGroup],
    provider: cluster.provider
  }
);

const ednsCRB = new k8s.rbac.v1.ClusterRoleBinding(
  'external-dns-crb',
  {
    metadata: { name: 'external-dns' },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'ClusterRole',
      name: 'external-dns'
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: 'external-dns',
        namespace: kubeSystemNamespace
      }
    ]
  },
  {
    dependsOn: [cluster, managedNodeGroup],
    provider: cluster.provider
  }
);

// Create namespaces
const aiSystemNs = new k8s.core.v1.Namespace(
  'aitomatic-system',
  {
    metadata: {
      name: 'aitomatic-system',
      labels: { 'istio-injection': 'enabled' }
    }
  },
  {
    dependsOn: [cluster, managedNodeGroup],
    provider: cluster.provider
  }
);

const aiInfraNs = new k8s.core.v1.Namespace(
  'aitomatic-infra',
  {
    metadata: {
      name: 'aitomatic-infra',
      labels: { 'istio-injection': 'enabled' }
    }
  },
  {
    dependsOn: [cluster, managedNodeGroup],
    provider: cluster.provider
  }
);

const aiMonitorNs = new k8s.core.v1.Namespace(
  'aitomatic-monitor',
  {
    metadata: {
      name: 'aitomatic-monitor'
    }
  },
  {
    dependsOn: [cluster, managedNodeGroup],
    provider: cluster.provider
  }
);

const aiAppsNs = new k8s.core.v1.Namespace(
  'aitomatic-apps',
  {
    metadata: {
      name: 'aitomatic-apps',
      labels: { 'istio-injection': 'enabled' }
    }
  },
  {
    dependsOn: [cluster, managedNodeGroup],
    provider: cluster.provider
  }
);

// Create a limited role for the `pulumi:devs` to use in the apps namespace.
const roleNamespaces = [aiAppsNs.metadata.name];
roleNamespaces.forEach((roleNs, index) => {
  const devsGroupRole = new k8s.rbac.v1.Role(
    `pulumi-devs-${index}`,
    {
      metadata: { namespace: roleNs },
      rules: [
        {
          apiGroups: [''],
          resources: [
            'configmap',
            'pods',
            'secrets',
            'services',
            'persistentvolumeclaims'
          ],
          verbs: ['get', 'list', 'watch', 'create', 'update', 'delete']
        },
        {
          apiGroups: ['rbac.authorization.k8s.io'],
          resources: [
            'clusterrole',
            'clusterrolebinding',
            'role',
            'rolebinding'
          ],
          verbs: ['get', 'list', 'watch', 'create', 'update', 'delete']
        },
        {
          apiGroups: ['extensions', 'apps'],
          resources: ['replicasets', 'deployments'],
          verbs: ['get', 'list', 'watch', 'create', 'update', 'delete']
        }
      ]
    },
    { provider: cluster.provider }
  );

  // Bind the `pulumi:devs` RBAC group to the new, limited role.
  const devsGroupRoleBinding = new k8s.rbac.v1.RoleBinding(
    `pulumi-devs-${index}`,
    {
      metadata: { namespace: roleNs },
      subjects: [
        {
          kind: 'Group',
          name: 'pulumi:devs'
        }
      ],
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'Role',
        name: devsGroupRole.metadata.name
      }
    },
    { provider: cluster.provider }
  );
});

// Deploy metrics-server from Bitnami Helm Repo to aitomatic-system Namespace
const metricsServerChart = new k8s.helm.v3.Chart(
  'kubesys-ms',
  {
    chart: 'metrics-server',
    version: '3.5.0',
    namespace: kubeSystemNamespace,
    fetchOpts: {
      repo: 'https://kubernetes-sigs.github.io/metrics-server/'
    },
    values: {}
  },
  {
    dependsOn: [cluster, aiSystemNs],
    provider: cluster.provider
  }
);

const ednsRelease = new k8s.helm.v3.Release(
  'edns',
  {
    chart: 'external-dns',
    version: '1.3.2',
    namespace: kubeSystemNamespace,
    name: 'external-dns',
    repositoryOpts: {
      repo: 'https://kubernetes-sigs.github.io/external-dns/'
    },
    values: {
      provider: 'aws-sd',
      domainFilters: [clientEnvDomain],
      serviceAccount: {
        create: false,
        name: 'external-dns'
      },
      rbac: {
        create: false
      },
      env: [
        {
          name: 'AWS_REGION',
          value: awsRegion
        }
      ],
      sources: ['service', 'ingress', 'istio-gateway', 'istio-virtualservice']
    },
    skipAwait: true
  },
  {
    dependsOn: [cluster, aiSystemNs, ednsRole],
    provider: cluster.provider
  }
);

// Kubernetes Dashboard

const k8sDash = new k8s.helm.v3.Chart(
  'kubesys-dash',
  {
    chart: 'kubernetes-dashboard',
    version: '5.0.3',
    namespace: kubeSystemNamespace,
    fetchOpts: {
      repo: 'https://kubernetes.github.io/dashboard/'
    },
    values: {}
  },
  {
    dependsOn: [cluster, aiSystemNs, metricsServerChart],
    provider: cluster.provider
  }
);

// Setup Kubernetes Autoscaler

const autoscalerAssumeRolePolicy = pulumi
  .all([clusterOidcProviderUrl, clusterOidcArn])
  .apply(([url, arn]) =>
    aws.iam.getPolicyDocument({
      statements: [
        {
          effect: 'Allow',
          principals: [
            {
              identifiers: [arn],
              type: 'Federated'
            }
          ],
          actions: ['sts:AssumeRoleWithWebIdentity'],
          conditions: [
            {
              test: 'StringEquals',
              values: [
                'system:serviceaccount:kube-system:autoscaler-aws-cluster-autoscaler'
              ],
              variable: `${url}:sub`
            }
          ]
        }
      ]
    })
  );

const autoscalerRole = new aws.iam.Role(`${pulumiStack}-autoscaler`, {
  assumeRolePolicy: autoscalerAssumeRolePolicy.json
});

const autoscalerPolicy = new aws.iam.Policy(
  `${pulumiStack}-autoscaler-policy`,
  {
    description: pulumi.interpolate`Autoscaler policy for ${cluster.eksCluster.id}`,
    policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            'autoscaling:DescribeAutoScalingGroups',
            'autoscaling:DescribeAutoScalingInstances',
            'autoscaling:DescribeLaunchConfigurations',
            'autoscaling:DescribeTags',
            'autoscaling:SetDesiredCapacity',
            'autoscaling:TerminateInstanceInAutoScalingGroup',
            'ec2:DescribeLaunchTemplateVersions'
          ],
          Resource: '*'
        }
      ]
    })
  }
);

new aws.iam.RolePolicyAttachment(
  `${pulumiStack}-autoscaler-role-attach-policy`,
  {
    policyArn: autoscalerPolicy.arn,
    role: autoscalerRole.name
  }
);

const autoscaler = new k8s.helm.v3.Release(
  'autoscaler',
  {
    name: 'autoscaler',
    version: '9.10.7',
    namespace: kubeSystemNamespace,
    chart: 'cluster-autoscaler',
    repositoryOpts: {
      repo: 'https://kubernetes.github.io/autoscaler'
    },
    skipAwait: true,
    values: {
      cloudProvider: 'aws',
      rbac: {
        serviceAccount: {
          annotations: {
            'eks.amazonaws.com/role-arn': autoscalerRole.arn
          }
        }
      },
      awsRegion: awsRegion,
      autoDiscovery: {
        enabled: true,
        clusterName: cluster.eksCluster.name
      }
    }
  },
  {
    provider: cluster.provider,
    dependsOn: [cluster, metricsServerChart]
  }
);

function elasticInstall(
  releaseName: string,
  chart: string,
  values: { [key: string]: any } = {}
) {
  return new k8s.helm.v3.Chart(
    releaseName,
    {
      chart: chart,
      namespace: aiMonitorNs.id,
      fetchOpts: {
        repo: 'https://helm.elastic.co'
      },
      values: values,
      skipAwait: true
    },
    {
      dependsOn: [aiMonitorNs, cluster],
      provider: cluster.provider
    }
  );
}

const apmServerValues = {
  fullnameOverride: 'apm-server'
};

const elasticSearch = elasticInstall('elastic-search', 'elasticsearch');
const apmServer = elasticInstall('apm-server', 'apm-server', apmServerValues);
const kibana = elasticInstall('kibana', 'kibana');

const prometheus = new k8s.helm.v3.Release(
  'prometheus',
  {
    chart: 'kube-prometheus-stack',
    namespace: aiMonitorNs.id,
    repositoryOpts: {
      repo: 'https://prometheus-community.github.io/helm-charts'
    },
    values: {
      prometheus: {
        prometheusSpec: {
          remote_write: [
            {
              url: 'http://localhost:9201/write'
            }
          ]
        }
      }
    }
  },
  {
    dependsOn: [aiMonitorNs, cluster],
    provider: cluster.provider
  }
);

const jaeger = new k8s.helm.v3.Release(
  'jaeger',
  {
    chart: 'jaeger',
    namespace: aiMonitorNs.id,
    repositoryOpts: {
      repo: 'https://jaegertracing.github.io/helm-charts'
    },
    values: {
      provisionDataStore: {
        cassandra: false,
        elasticsearch: false
      },
      collector: {
        enabled: false
      },
      query: {
        enabled: false
      },
      agent: {
        cmdlineParams: {
          'reporter.grpc.host-port': 'apm-server:8200'
        }
      }
    }
  },
  {
    dependsOn: [aiMonitorNs, cluster],
    provider: cluster.provider
  }
);

// Setup Istio
const aiIstioNs = new k8s.core.v1.Namespace(
  'istio-system',
  { metadata: { name: 'istio-system' } },
  {
    provider: cluster.provider,
    dependsOn: [cluster, managedNodeGroup]
  }
);

const aiIstioIngressNs = new k8s.core.v1.Namespace(
  'istio-ingress',
  { metadata: { name: 'istio-ingress' } },
  {
    provider: cluster.provider,
    dependsOn: [cluster, managedNodeGroup]
  }
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
        name: 'admin'
      }
    ]
  },
  {
    dependsOn: [cluster],
    provider: cluster.provider
  }
);

const istio = new k8s.helm.v3.Release(
  'aisys-istio',
  {
    chart: 'istio',
    version: '1.11.1',
    namespace: aiIstioNs.id,
    repositoryOpts: {
      repo: 'https://getindata.github.io/helm-charts/'
    },
    values: {},
    skipAwait: true
  },
  {
    dependsOn: [aiIstioNs, cluster],
    provider: cluster.provider
  }
);

const kiali = new k8s.helm.v3.Release(
  'aisys-kiali',
  {
    chart: 'kiali-server',
    namespace: aiIstioNs.id,
    repositoryOpts: {
      repo: 'https://kiali.org/helm-charts/'
    },
    values: {
      auth: {
        strategy: 'anonymous'
      }
    }
  },
  {
    dependsOn: [istio, cluster],
    provider: cluster.provider
  }
);

//Put DB Secrets in Infra Namespace
const secretInfra = new kx.Secret(
  'aitomatic-infradb-secrets',
  {
    stringData: {
      'aitomatic-db-user': db.username,
      'aitomatic-db-password': db.password,
      'aitomatic-db-host': db.address,
      'aitomatic-db-port': db.port.apply((x) => `${x}`),
      'aitomatic-db-dbname': db.id
    },
    metadata: {
      namespace: aiInfraNs.id
    }
  },
  {
    dependsOn: [cluster],
    provider: cluster.provider
  }
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
      'aitomatic-db-dbname': db.id
    },
    metadata: {
      namespace: aiAppsNs.id
    }
  },
  {
    dependsOn: [cluster],
    provider: cluster.provider
  }
);

// Install JenkinsX
const jxGitopNsName = 'jx-git-operator';

const jxGitopNs = new k8s.core.v1.Namespace(
  jxGitopNsName,
  { metadata: { name: jxGitopNsName } },
  {
    provider: cluster.provider,
    dependsOn: [cluster, managedNodeGroup]
  }
);

const jxgit = new k8s.helm.v3.Release(
  'jx3',
  {
    chart: 'jx-git-operator',
    namespace: jxGitopNsName,
    repositoryOpts: {
      repo: 'https://jenkins-x-charts.github.io/repo'
    },
    values: {
      url: jxGitUrl,
      username: jsGitUsername,
      password: jxGitToken
    }
  },
  {
    dependsOn: [managedNodeGroup, cluster],
    provider: cluster.provider
  }
);

const seldonChart = new k8s.helm.v3.Release(
  'aiinfra-seldon',
  {
    name: 'aiinfra-seldon',
    chart: 'seldon-core-operator',
    version: '1.11',
    namespace: aiInfraNs.id,
    repositoryOpts: {
      repo: 'https://storage.googleapis.com/seldon-charts/'
    },
    values: {
      istio: {
        enabled: true,
        gateway: 'istio-ingressgateway'
      },
      ambassador: {
        enabled: false
      },
      usageMetrics: {
        enabled: true
      }
    }
  },
  {
    dependsOn: [cluster, istio, aiInfraNs],
    provider: cluster.provider
  }
);

// Install Spark Operator
// const sparkOperatorChart = new k8s.helm.v3.Chart(
//   'spark-operator',
//   {
//     chart: 'spark-operator',
//     version: '1.1.6',
//     namespace: aiInfraNs.id,
//     fetchOpts: {
//       repo: 'https://googlecloudplatform.github.io/spark-on-k8s-operator'
//     },
//     values: {
//       istio: {
//         enabled: true
//       },
//       image: {
//         tag: 'v1beta2-1.2.3-3.1.1'
//       },
//       sparkJobNamespace: aiAppsNs.id,
//       serviceAccounts: {
//         spark: {
//           name: 'spark'
//         },
//         sparkoperator: {
//           name: 'spark-operator'
//         }
//       },
//       webhook: {
//         enable: true
//       }
//     }
//   },
//   {
//     dependsOn: [istio, cluster],
//     provider: cluster.provider
//   }
// );

// Setup Jupyterhub
const jhNs = new k8s.core.v1.Namespace(
  'jupyterhub',
  {
    metadata: {
      name: 'jupyterhub',
      labels: { 'istio-injection': 'disabled' }
    }
  },
  {
    provider: cluster.provider,
    dependsOn: [cluster, managedNodeGroup]
  }
);

const jh = new k8s.helm.v3.Release(
  'jupyterhub',
  {
    chart: 'jupyterhub',
    name: 'jupyterhub',
    namespace: jhNs.id,
    version: '1.1.3',
    repositoryOpts: {
      repo: 'https://jupyterhub.github.io/helm-chart/'
    },
    values: {
      hub: {
        config: {
          GitHubOAuthenticator: {
            client_id: githubClientId,
            client_secret: githubClientSecret,
            oauth_callback_url: `http://hub.${clientEnvDomain}/hub/oauth_callback`,
            allowed_organizations: githubOrgs
          },
          JupyterHub: {
            authenticator_class: 'github'
          }
        }
      },
      prePuller: {
        hook: {
          enabled: false
        }
      },
      ingress: {
        enabled: true,
        annotations: {
          'kubernetes.io/ingress.class': 'istio',
          'external-dns.alpha.kubernetes.io/hostname': `hub.${clientEnvDomain}`
        },
        hosts: [`hub.${clientEnvDomain}`]
      }
    },
    skipAwait: true
  },
  {
    dependsOn: [cluster, istio, aiInfraNs],
    provider: cluster.provider
  }
);

// Install fluent-bit
const fluentBitInputConfig = `
[INPUT]
    Name tail
    Path /var/log/containers/*.log
    multiline.parser docker, cri
    Tag kube.*
    Mem_Buf_Limit 5MB
    Skip_Long_Lines On

[INPUT]
    Name systemd
    Tag host.*
    Systemd_Filter _SYSTEMD_UNIT=kubelet.service
    Read_From_Tail On

[INPUT]
    Name cpu
    Tag metrics.cpu.*

[INPUT]
    Name mem
    Tag metrics.mem.*
`;
const fluentBitOutputConfig = `
[OUTPUT]
    Name es
    Match kube.*
    Host elasticsearch-master
    Trace_Error On
    Logstash_Format On
    Logstash_Prefix logs
    Retry_Limit False
    Replace_Dots On
    
[OUTPUT]
    Name es
    Match host.*
    Host elasticsearch-master
    Trace_Error On
    Logstash_Format On
    Logstash_Prefix node
    Retry_Limit False
    Replace_Dots On

[OUTPUT]
    Name es
    Match metrics.*
    Host elasticsearch-master
    Trace_Error On
    Logstash_Format On
    Logstash_Prefix metrics
    Retry_Limit False
    Replace_Dots On
`;

const fluentBit = new k8s.helm.v3.Chart(
  'fluent-bit',
  {
    chart: 'fluent-bit',
    namespace: aiMonitorNs.id,
    version: '0.19.5',
    fetchOpts: {
      repo: 'https://fluent.github.io/helm-charts/'
    },
    values: {
      config: {
        inputs: fluentBitInputConfig,
        outputs: fluentBitOutputConfig
      }
    }
  },
  {
    dependsOn: [cluster, aiMonitorNs, elasticSearch, kibana],
    provider: cluster.provider
  }
);
