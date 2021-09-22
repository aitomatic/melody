import prefect
from prefect import Flow, task, Parameter
from pathlib import Path
import os
import yaml
from prefect.engine.signals import LOOP
from pulumi import automation as auto
from pulumi.automation._config import ConfigMap


"""
Currently we have everything prefect in a single file for easy localc development
In future we will modularize this. 
"""

class PulumiHandler():

    """
        Issue https://github.com/pulumi/pulumi/issues/2522 prevents us from using "/" in stack names when not using Pulumi hosted service,
        and using other backends (local, S3, etc.)
        So we will use "." instead.
    """
    def build_stack_name(self, org: str, project: str, stack: str):
        return f"{org}.{project}.{stack}"


    def preview(self, org: str, project: str, stack: str, config_map: ConfigMap = None):
        work_dir = os.path.join(os.path.dirname(__file__), "..", "projects", project)
        stack_name = self.build_stack_name(org, project, stack)
        pstack = auto.create_or_select_stack(stack_name=stack_name, work_dir=work_dir)
 
        if(config_map):
            pstack.set_all_config(config_map)

        pstack.refresh()

        return pstack.preview()


    def up(self, org: str, project: str, stack: str, config_map: ConfigMap = None):
        work_dir = os.path.join(os.path.dirname(__file__), "..", "projects", project)
        stack_name = self.build_stack_name(org, project, stack)
        pstack = auto.create_or_select_stack(stack_name=stack_name, work_dir=work_dir)
 
        if(config_map):
            pstack.set_all_config(config_map)

        pstack.refresh()

        return pstack.up()


    def destroy(self, org: str, project: str, stack: str, config_map: ConfigMap = None):
        stack_name = auto.fully_qualified_stack_name(org, project, stack)
        stack = auto.create_or_select_stack(stack_name=stack_name, work_dir=self.work_dir)
        stack.set_all_config(self.config_map)

        stack.refresh()

        return stack.destroy()


@task
def log(x):
    logger = prefect.context.get("logger")
    logger.info(x)
    return x

@task
def read_yaml(spec: str):
    logger = prefect.context.get("logger")
    file_path: str = Path(__file__).resolve().parent.as_posix()
    spec_file: str = os.path.join(file_path, "..", "flows", spec)
    #logger.info("Reading file: {}", spec_file)
    content = ""
    with open(spec_file) as file:
        content = file.read()
    yml = yaml.load(content)
    return yml["steps"]

@task
def pulumi_up(org: str, stack: str, projects: list):

    loop_payload = prefect.context.get("task_loop_result", {})

    remaining_projects = loop_payload.get("remaining_projects", projects)
    results = loop_payload.get("results", {})

    logger = prefect.context.get("logger")
    runner = PulumiHandler()
    project = remaining_projects.pop(0)
    results[project] = runner.preview(org, project, stack).change_summary

    if remaining_projects:
        raise LOOP(message="Completed project", result={"remaining_projects": remaining_projects, "results": results})
    else:
        return results

with Flow("melody") as flow:
    flow_spec = Parameter("flow_spec", default="test.yml")
    org = Parameter("org", default="aitomatic")
    stack = Parameter("stack", default="stack")
    flow_steps = read_yaml(flow_spec)
    stacks = pulumi_up(org, stack, flow_steps)
    final = log(stacks)


if __name__=="__main__":
    flow.register("test01", set_schedule_active=False)

#flow.visualize()  
