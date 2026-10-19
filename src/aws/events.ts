import { z } from 'zod';

export interface InvokeEvent {
  eventType: 'INVOKE';
  deadlineMs: number;
  requestId: string;
  invokedFunctionArn: string;
  tracing: {
    type: string;
    value: string;
  };
}

export interface ShutdownEvent {
  eventType: 'SHUTDOWN';
  shutdownReason: string;
  deadlineMs: string;
}

export type FunctionLogEvent = z.infer<typeof functionLogEventSchema>;

export const functionLogEventSchema = z.object({
  type: z.literal('function'),
  time: z.preprocess((value) => (typeof value === 'string' ? new Date(value) : undefined), z.date()), // "2022-10-12T00:03:50.000Z"
  record: z.string(), // "[INFO] Hello world, I am a function!"
});

// Lambda reports with this event that the runtime finished an invocation; the Telemetry API delivers events in order,
// so the invocation's function logs have been delivered by then.
export const platformRuntimeDoneEventSchema = z.object({
  type: z.literal('platform.runtimeDone'),
  record: z.object({
    requestId: z.string(),
  }),
});
