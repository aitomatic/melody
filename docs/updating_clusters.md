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
5. Run command to update stack and EKS cluster
```shell
pulumi up
```
- Note: If you have error `Either name or zone_id must be set` then add these setting to file `Pulumi.<cluster-name>.yaml` in local
    ```
    config:
      ai:parentzone: cc.aitomatic.com
      aws:region: <cluster-region>
    ```
- Note: If you have error `panic: fatal: An assertion has failed` then run this command
    ```shell
    pulumi up --skip-preview
    ```
6. Fix errors if exists until `pulumi up` command run successfully
- If you have error related to kubernetes resource already exists (service, configmap, etc.) then run `kubectl delete` command to cleanup it.
7. Run kubectl command to verify EKS cluster is running normal
```shell
kubectl get ns
kubectl get pod -A
```

### TODO

1. Automatically add permission to access S3 and AWS resources to the cluster admin role
