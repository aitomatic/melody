## Accessing kibana running on K8s cluster
Before proceeding, please ensure you have the following tools installed:
* awscli
* pulumi
* kubectl

### Steps
1. Setup local environment
- **Note**: run this command if default profile is not Aitomatic:
    ```shell
    export AWS_PROFILE=<aitomatic-aws-config-profile>
    ```
```shell
cd src/projects/aws-eks
export AWS_REGION=us-west-2
export PULUMI_CONFIG_PASSPHRASE=*******
export KUBECONFIG=`pwd`/kubeconfig
pulumi login s3://ai-pulumi-stacks
pulumi stack ls
pulumi stack select <cluster-name>
pulumi stack output kubeconfig > kubeconfig
pulumi stack output awsProfileSnippet >> ~/.aws/config
export AWS_PROFILE=<cluster-name>
```
2. Run kubectl command to port-forward kibana service to localhost
```shell
kubectl port-forward service/kibana-kibana 5601 -n aitomatic-monitor
```
3. Access to `localhost:5601` to view kibana UI
4. Go to menu `Observability/Logs/Stream` to view list of logs. From there, we can search, view logs by date range, etc.
