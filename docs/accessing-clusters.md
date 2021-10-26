
## Accessing clusters running on AWS
Before proceeding, please ensure you have the following tools installed:
* awscli
* pulumi
* kubectl

### Steps
1. Login using the following commands
```shell
cd src/projects/aws-eks/
pulumi login s3://ai-pulumi-stacks
```
2. You can now view the available clusters using,
```shell
pulumi stack ls
```
3. To configure kubectl to work with a specific cluster,
```shell
export PULUMI_CONFIG_PASSPHRASE=******* 
pulumi stack select <replace-with-cluster-name> # check result from step 2
pulumi stack output kubeconfig > kubeconfig
export KUBECONFIG=`pwd`/kubeconfig
pulumi stack output awsProfileSnippet >> ~/.aws/config
export AWS_PROFILE=<replace-with-cluster-name>
```
4. Now, you should be able to view the resources using kubectl,
```shell
kubectl get namespaces
```