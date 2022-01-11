## Updating pulumi stack and running clusters in AWS

Before proceeding, please ensure you have the following tools installed:
* awscli
* pulumi
* kubectl

### Steps

1. Login to pulumi stack in S3
- **Note**: run this command if default profile is not Aitomatic:
    ```shell
    export AWS_PROFILE=<aitomatic-aws-config-profile>
    ```
```shell
cd src/projects/aws-eks
export AWS_REGION=us-west-2
pulumi login s3://ai-pulumi-stacks
```
2. List and select running cluster to update
```shell
pulumi stack ls
export PULUMI_CONFIG_PASSPHRASE=*******
pulumi stack select <cluster-name>
```
3. Config kubectl to connect to selected cluster
```shell
pulumi stack output kubeconfig > kubeconfig
export KUBECONFIG=`pwd`/kubeconfig
pulumi stack output awsProfileSnippet >> ~/.aws/config
export AWS_PROFILE=<cluster-name>
```
4. Run command to refresh resources' status
```shell
pulumi refresh
```
- Note: If you have authorization or Access Denied error then use IAM console to add permissions to the cluster admin role:
    + ai-pulumi-stacks-access
    + AdministratorAccess
5. Run the command,
 ```shell
  pulumi config set aws:region <cluster-region>
  pulumi config set ai:parentzone cc.aitomatic.com
```
There are 2 options to update:

a. Update entire stack and EKS cluster. This can impact all existing application deployments and the EKS cluster.
```shell
pulumi up
```
b. Update a specific component only. This can impact existing deployments that depend on this component.
  1. Find the urn for the component using `pulumi stack -u`
  2. Delete the component using the urn,
  ```shell
  pulumi destroy --target <component-urn> --target-dependents 
  ```
  The `component-urn` will be of the format - `urn:pulumi:<stack-name>::aitomatic-ml-infra::kubernetes:helm.sh/v3:Release::<component-name>`
  3. Set any configuration used by the component
  4. Bring up the component by running the command,
    ```shell
      pulumi up --target <component-urn> --target-dependents 
    ```
7. Run kubectl commands and verify changes
```shell
kubectl get ns
kubectl get pod -A
```
8. Run command to save updated stack
```shell
pulumi refresh
```

### TODO

1. Automatically add permission to access S3 and AWS resources to the cluster admin role
