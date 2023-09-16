import {t} from "@server/init/t";
import {spawnTimeline} from "@server/spawners/timeline";
import {Entity} from "@server/utils/ecs";
import {z} from "zod";
import {triggerStep} from "@server/utils/evaluateEntityQuery";

export const timeline = t.router({
  activate: t.procedure
    .meta({action: true})
    .input(z.object({pluginId: z.string(), timelineId: z.string()}))
    .send(({ctx, input}) => {
      if (!ctx.flight) return;
      const timeline = ctx.server.plugins
        .find(plugin => plugin.id === input.pluginId)
        ?.aspects.timelines.find(
          timeline => timeline.name === input.timelineId
        );
      if (!timeline) return;
      const stepIds = spawnTimeline(timeline, (entity: Entity) => {
        ctx.flight?.ecs.addEntity(entity);
      });

      // Trigger the first step
      triggerStep(ctx.flight.ecs.getEntityById(stepIds[0])!);
    }),
  advance: t.procedure
    .meta({action: true, inputs: ["timelineId"]})
    .input(
      z.object({
        timelineId: z
          .number()
          .optional()
          .describe(
            "If using in a timeline action trigger, leave blank to advance the current timeline."
          ),
        stepId: z.number().optional(),
      })
    )
    .send(({ctx, input}) => {
      let timeline: Entity | undefined | null;
      if (input.timelineId !== undefined) {
        timeline = ctx.flight?.ecs.getEntityById(input.timelineId);
      } else if (typeof input.stepId === "number") {
        const timelines = Array.from(
          ctx.flight?.ecs.componentCache.get("isTimeline") || []
        );
        timeline = timelines?.find(timeline =>
          timeline.components.isTimeline?.steps.includes(input.stepId!)
        );
      }
      if (!timeline) return;
      const stepIndex = timeline?.components.isTimeline?.currentStep;
      if (stepIndex === undefined) return;
      const steps = timeline.components.isTimeline?.steps;
      if (!steps) return;
      const nextStep = steps[stepIndex + 1];
      if (nextStep === undefined) return;
      timeline.updateComponent("isTimeline", {currentStep: stepIndex + 1});

      triggerStep(ctx.flight!.ecs.getEntityById(steps[stepIndex + 1])!);
      // TODO: August 25, 2023 Send the necessary pubsub updates
    }),
  goToStep: t.procedure
    .meta({action: true})
    .input(
      z.object({
        timelineId: z
          .number()
          .optional()
          .describe(
            "Leave blank to use the timeline associated with the step."
          ),
        stepId: z.number(),
      })
    )
    .send(({ctx, input}) => {
      let timeline: Entity | undefined | null;
      if (input.timelineId !== undefined) {
        timeline = ctx.flight?.ecs.getEntityById(input.timelineId);
      } else if (typeof input.stepId === "number") {
        const timelines = Array.from(
          ctx.flight?.ecs.componentCache.get("isTimeline") || []
        );
        timeline = timelines?.find(timeline =>
          timeline.components.isTimeline?.steps.includes(input.stepId!)
        );
      }
      if (!timeline) return;
      const steps = timeline.components.isTimeline?.steps;
      if (!steps) return;
      const stepIndex = steps.indexOf(input.stepId);
      if (typeof stepIndex !== "number" || stepIndex === -1) return;
      timeline.updateComponent("isTimeline", {currentStep: stepIndex});

      triggerStep(ctx.flight!.ecs.getEntityById(steps[stepIndex])!);
      // TODO: August 25, 2023 Send the necessary pubsub updates
    }),
  deactivate: t.procedure
    .meta({action: true})
    .input(z.object({timelineId: z.number()}))
    .send(({ctx, input}) => {
      const timeline = ctx.flight?.ecs.getEntityById(input.timelineId);
      if (!timeline) return;
      const steps = timeline.components.isTimeline?.steps;
      if (!steps) return;
      for (let stepId of steps) {
        const step = ctx.flight?.ecs.getEntityById(stepId);
        if (!step) continue;
        step.updateComponent("isTimelineStep", {active: false});
      }

      // TODO: August 25, 2023 Send the necessary pubsub updates
      // Also, at some point we'll want to make it so every trigger generated by this timeline
      // is deactivated so we don't accidentally re-activate the timeline by triggering one of those triggers
    }),
});
