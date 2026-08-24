import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPersonal: z.boolean(),
});

export const rpcContract = defineRpcContract({
  listProjects: {
    input: z.null(),
    output: z.object({ projects: z.array(projectSchema) }),
  },
});

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    async listProjects() {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      return {
        projects: projects
          .map((project) => ({
            id: project.id,
            name:
              project.kind === "personal"
                ? "Don’t work in a project"
                : project.name,
            isPersonal: project.kind === "personal",
          }))
          .sort((left, right) => {
            if (left.isPersonal !== right.isPersonal) {
              return left.isPersonal ? -1 : 1;
            }
            return left.name.localeCompare(right.name);
          }),
      };
    },
  });
}
