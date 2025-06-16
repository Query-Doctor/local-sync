import { Span, SpanStatusCode, trace } from "npm:@opentelemetry/api";

export const tracer = trace.getTracer("sync", "0.0.1");

export function withSpan<Args extends unknown[], T>(
  name: string,
  cb: (span: Span, ...args: Args) => Promise<T>
): (...args: Args) => Promise<T> {
  return (...args: Args) => {
    return tracer.startActiveSpan(name, async (span) => {
      try {
        return await cb(span, ...args);
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    });
  };
}
