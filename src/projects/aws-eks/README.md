## Working with the Infra Pulumi Project

1. Install and configure Nodejs, Python, AWS CLI, kubectl HELM and Pulumi
//TODO: Add links

2. Setup Pulumi not to use Pulumi Cloud

```
$ prefect backend server
```

3. Configure your AWS credentials

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

if you are not using default profile

```
$ export AWS_PROFILE=<profile_name>
$ pulumi config set aws:profile <profile_name>
```

7. Configure JenkinsX Operator

JenkinsX uses GitOps for deployment. THis makes it a bit complex to accomodate in our workflow. If you are doing a development deployment, you can use this repo `https://github.com/Aitomatic/jx3-kubernetes.git` in case of new customer onboarding, please create a clone of this repo in the format  `https://github.com/Aitomatic/jx3-kubernetes-<customer>.git` and use that.

Use the AI Engineer Bot account creds for Github.

```
$ pulumi config set jx:giturl <git_repo_url>
$ pulumi config set jx:gitusername <git_bot_username>
$ pulumi config set jx:gittoken <git_bot_token>
```

8. It will take 15-20 minutes, once the infra is up and running, you can go to AWS and see the cluster, RDS and all other components.

```
$ pulumi up
```

9. Fetch KubeConfig for you new cluster and set it to be used with kubectl

```
$ pulumi stack output kubeconfig > kubeconfig
$ export KUBECONFIG=`pwd`/kubeconfig
```

10. Now you should be ready to use the K8s cluster with kubectl

```
kubectl get namespaces
```

11. Install and run VMWare Octant from the console to get a visual interface to the cluster

12. You can add JenkinsX plugin to Octant - https://github.com/jenkins-x-plugins/octant-jx

 


