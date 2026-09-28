export type Thread = {
  id: string;
  title: string;
  projectName: string | null;
  updatedAt: number;
};

const RECENT_THREAD_LIMIT = 8;
const MATCHING_THREAD_LIMIT = 20;

export function matchThreads(threads: Thread[], normalizedQuery: string) {
  if (normalizedQuery === "") return threads.slice(0, RECENT_THREAD_LIMIT);
  return threads
    .filter((thread) =>
      thread.title.toLocaleLowerCase().includes(normalizedQuery),
    )
    .slice(0, MATCHING_THREAD_LIMIT);
}
