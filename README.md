A simple orchestrator Using Pulumi to deploy the infra components and Prefect to orchestrate various components in a workflow.



Get Pulumi to write out the kubeconfig - 

```
$ pulumi stack output kubeconfig > kubeconfig
$ export KUBECONFIG=`pwd`/kubeconfig
```
