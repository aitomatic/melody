## Working with the Infra Pulumi Project

1. Install and configure Nodejs, Python, AWS CLI, kubectl HELM and Pulumi
//TODO: Add links

2. Setup Pulumi not to use Pulumi Cloud

```
$ prefect backend server
```

3. Configure you AWS credentials

```
$ aws configure 
```

4. Setup *PULUMI_CONFIG_PASSPHRASE* to encode data locally

```
$ export PULUMI_CONFIG_PASSPHRASE=<value>
```

5. Initiate a Pulumi stack

```
$ pulumi stack init
```

6. Setup AWS Region for Pulumi

```
$ pulumi config set aws:region us-west-2
```

7. It will take 15-20 minutes, once the infra is up and running, you can go to AWS and see the cluster, RDS and all other components.

8. Fetch KubeConfig for you new cluster and set it to be used with kubectl

```
$ pulumi stack output kubeconfig > kubeconfig
$ export KUBECONFIG=`pwd`/kubeconfig
```

9. Now you should be ready to use the K8s cluster with kubectl

```
kubectl get namespaces
```

10. Install and run VMWare Octant fro mthe console to get a visual interface to the cluster
 


