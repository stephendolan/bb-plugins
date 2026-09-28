import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const THREAD_LIMIT = 300;

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPersonal: z.boolean(),
});

const machineSchema = z.object({
  id: z.string(),
  name: z.string(),
  isConnected: z.boolean(),
});

const threadSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectName: z.string().nullable(),
  updatedAt: z.number(),
});

export const rpcContract = defineRpcContract({
  listTargets: {
    input: z.null(),
    output: z.object({
      projects: z.array(projectSchema),
      machines: z.array(machineSchema),
      threads: z.array(threadSchema),
      personalProjectId: z.string(),
    }),
  },
});

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    async listTargets() {
      const [projects, hosts, threads] = await Promise.all([
        bb.sdk.projects.list({ includePersonal: true }),
        bb.sdk.hosts.list(),
        bb.sdk.threads.list({ archived: false, limit: THREAD_LIMIT }),
      ]);
      const personalProject = projects.find(
        (project) => project.kind === "personal",
      );
      if (!personalProject) {
        throw new Error("BB did not return its personal project.");
      }
      const projectNames = new Map(
        projects
          .filter((project) => project.kind !== "personal")
          .map((project) => [project.id, project.name]),
      );

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
        machines: hosts
          .map((host) => ({
            id: host.id,
            name: host.name,
            isConnected: host.status === "connected",
          }))
          .sort((left, right) => {
            if (left.isConnected !== right.isConnected) {
              return left.isConnected ? -1 : 1;
            }
            return left.name.localeCompare(right.name);
          }),
        threads: threads
          .map((thread) => ({
            id: thread.id,
            title: thread.title ?? thread.titleFallback ?? "Untitled thread",
            projectName: projectNames.get(thread.projectId) ?? null,
            updatedAt: thread.updatedAt,
          }))
          .sort((left, right) => right.updatedAt - left.updatedAt),
        personalProjectId: personalProject.id,
      };
    },
  });
}
