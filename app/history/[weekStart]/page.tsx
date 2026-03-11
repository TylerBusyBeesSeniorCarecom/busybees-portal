// app/history/[weekStart]/page.tsx
import HistoryWeekClient from "../HistoryWeekClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    weekStart: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { weekStart } = await params;

  return <HistoryWeekClient weekStart={weekStart} />;
}