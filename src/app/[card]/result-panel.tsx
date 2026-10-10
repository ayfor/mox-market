// The streamed panel (S2.1d9, S2.1d18): awaits buildEvaluation, which never
// throws, and renders the pure ResultView. Keeping logic out of this async
// server component lets tests await it as a function.
import {
  buildEvaluation,
  defaultEvaluationDeps,
  type EvaluationDeps,
  type EvaluationQuery,
} from "@/lib/evaluation/build-evaluation";
import { ResultView } from "./result-view";

export async function ResultPanel({
  query,
  deps = defaultEvaluationDeps,
}: {
  query: EvaluationQuery;
  deps?: EvaluationDeps;
}) {
  const evaluation = await buildEvaluation(query, deps);
  return <ResultView evaluation={evaluation} />;
}
