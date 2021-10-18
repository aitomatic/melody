# Guide to deploy Spark job to Kubernetes

## Step-by-step guide

1. Build a Docker image with Spark environment
2. Define a `SparkApplication` kubernetes (k8s) object with all neccessary fields. For example:
    ```yaml
    apiVersion: "sparkoperator.k8s.io/v1beta2"
    kind: SparkApplication
    metadata:
      name: spark-pi
      namespace: aitomatic-apps
    spec:
      type: Scala
      mode: cluster
      image: "gcr.io/spark-operator/spark:v2.4.5"
      imagePullPolicy: Always
      mainClass: org.apache.spark.examples.SparkPi
      mainApplicationFile: "local:///opt/spark/examples/jars/spark-examples_2.11-2.4.5.jar"
      sparkVersion: "2.4.5"
      restartPolicy:
        type: Never
      driver:
        cores: 1
        coreLimit: "1200m"
        memory: "512m"
        labels:
          version: 2.4.5
        serviceAccount: spark
      executor:
        cores: 1
        instances: 1
        memory: "512m"
        labels:
          version: 2.4.5
        serviceAccount: spark
    ```
    - `kind`: SparkApplication or ScheduledSparkApplication
    - `metadata.name`: name of the spark application
    - `metadata.namespace`: k8s namespace to deploy to. Currently, the spark job only allowed to run in **aitomatic-apps** namespace
    - `spec.type`: type of job (Python, Java, Scala or R)
    - `spec.image`: docker image to run the job
    - `spec.mainClass` and `spec.mainApplicationFile`: class and URI of the application jar. More in **References** section about application dependencies such as jars or files should be run together when submitting `spark-submit` command
    - `spec.sparkVersion`: spark version to be run in the job
    - `spec.driver` and `spec.executor`: section to define configuration of driver and executor such as how many instances to run, memory and cpu limits, number of cpu cores, etc. Currently we need to use **spark** serviceAccount to run job in k8s cluster.
3. Run **kubectl** command to run spark job in k8s cluster
    ```bash
    $ kubectl apply -f spark-job.yaml
    ```

## References

- https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/blob/master/docs/user-guide.md

## TODO

- Need to figure out how to update the exisiting Spark job or run the same spark job again without using delete and apply command, which will remove the driver pod of that job
- Need to figure out how to build docker image for spark environment to run
