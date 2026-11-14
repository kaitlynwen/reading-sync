import AuthGuard from "@/components/AuthGuard";
import GroupClient from "./GroupClient";

// Under `output: "export"`, every dynamic route segment must enumerate the
// params it emits at build time. Group ids are not known at build time — they
// are created at runtime in the backend — so we emit a single placeholder
// shell and resolve the real id on the client via `useParams` inside
// `GroupClient`. `dynamicParams = false` keeps the export purely static.
export const dynamicParams = false;

export function generateStaticParams(): { id: string }[] {
  return [{ id: "_" }];
}

export default function GroupPage() {
  // Restrict the group screen to an authenticated session, routing to /login
  // otherwise (Req 3.9). AuthGuard is a client component; composing it here
  // keeps this route's static-export shell intact.
  return (
    <AuthGuard>
      <GroupClient />
    </AuthGuard>
  );
}
