import { CompareView } from "@/components/compare-view";
import { readConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Page() {
  const cfg = readConfig();
  const projects = cfg.projects.map((p) => ({
    id: p.id,
    name: p.name,
    codename: p.codename,
    description: p.description,
  }));
  return <CompareView projects={projects} />;
}
