import { useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./src/server";
import { Icon } from "./src/components/Icon";
import { cn } from "./src/lib/utils";
import { ParentChip } from "./src/ParentChip";
import { SubagentsChip } from "./src/SubagentsChip";
import { ThreadInbox } from "./src/ThreadInbox";

function RenameAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [pending, setPending] = useState(false);
  const rename = async () => {
    if (pending) return;
    setPending(true);
    try {
      const result = await rpc.call("rename", { threadId });
      if (result.ok) toast.success("Thread renamed", { description: result.title });
      else toast.error("Could not rename thread", { description: result.error });
    } catch (error) {
      toast.error("Could not rename thread", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPending(false);
    }
  };
  return (
    <button
      type="button"
      title={pending ? "Naming and organizing…" : "Rename and refresh categories"}
      aria-label={pending ? "Naming and organizing" : "Rename and refresh categories"}
      disabled={pending}
      onClick={() => void rename()}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
    >
      <Icon
        name={pending ? "Loading" : "Edit"}
        className={cn("size-4", pending && "animate-spin")}
      />
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "curated",
    title: "Thread Curator",
    description: "Live Luna-created workstream categories with T3-style thread cards.",
    component: ThreadInbox,
  });

  app.slots.experimental_threadHeaderAction({
    id: "parent",
    title: "Parent thread",
    component: ParentChip,
  });

  app.slots.experimental_threadHeaderAction({
    id: "children",
    title: "Child threads",
    component: SubagentsChip,
  });

  app.slots.experimental_threadHeaderAction({
    id: "rename",
    title: "Thread name",
    component: RenameAction,
  });
});
