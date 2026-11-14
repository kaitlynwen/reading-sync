import CreateSessionClient from "./CreateSessionClient";

// Shares the `[id]` segment with the Group screen: group ids are created at
// runtime, so emit a single placeholder shell and resolve the real id on the
// client via `useParams` inside `CreateSessionClient`.
export const dynamicParams = false;

export function generateStaticParams(): { id: string }[] {
  return [{ id: "_" }];
}

export default function CreateSessionPage() {
  return <CreateSessionClient />;
}
