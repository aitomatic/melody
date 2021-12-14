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

6. Setup AWS Region and domain

```
$ pulumi config set aws:region us-west-2
$ pulumi config set ai:parentzone cc.aitomatic.com
```

if you are not using default profile

```
$ export AWS_PROFILE=<profile_name>
$ pulumi config set aws:profile <profile_name>
```

7. Configure JenkinsX Operator

JenkinsX uses GitOps for deployment. This makes it a bit complex to accommodate in our workflow. 
Please use the template repo https://github.com/Aitomatic/ai-ci-cluster-template  and create a repo in the format  `https://github.com/Aitomatic/ai-ci-cluster-<customer>.git`.
After creating the repo, update the file `jx-requirements.yml`. Some entries, such as region, env_name (i.e. cluster name) must be set.
After creating the repo, change access setting to @ai-aitomatic-developers team with Admin role

Use the AI Engineer Bot account creds for Github.

```
$ pulumi config set jx:giturl <git_repo_url>
$ pulumi config set jx:gitusername <git_bot_username>
$ pulumi config set jx:gittoken <git_bot_token> --secret
```

8. Configure github Authentication for JupyterHub
Create a GitHub OAuth App used for Jupyter Auth and set these values from that App -

```shell

pulumi config set github:clientid
pulumi config set github:clientsecret
```

9. It will take 15-20 minutes, once the infra is up and running, you can go to AWS and see the cluster, RDS and all other components.

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

13. Once the cluster is up and running, you need to add the security group from the autoscaling nodes to the generated postgres cluster. Currently, this is not automated. 


