import type { CollectionConfig } from "payload";

export const Runs: CollectionConfig = {
  slug: "runs",
  admin: {
    useAsTitle: "id",
    defaultColumns: [
      "job_state",
      "id",
      "source",
      // keep DB status but primary state is job_state above
      "status",
      "maxItems",
      "startedAt",
      "completedAt",
    ],
    description: "Individual scraping job executions",
  },
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
    delete: () => true,
  },
  fields: [
    // Computed Job State (from Source.status)
    {
      name: "job_state",
      label: "Job State",
      type: "ui",
      admin: {
        components: {
          Cell: "@/components/RunStateCell",
        },
        description: "active | paused | running (from Source)",
      },
    },
    // Relationships
    {
      name: "source",
      type: "relationship",
      relationTo: "sources",
      required: true,
      label: "Source",
    },

    // Execution Configuration (per-run)
    {
      name: "kind",
      type: "select",
      required: true,
      defaultValue: "manual",
      label: "Execution Type",
      options: [
        { label: "Manual", value: "manual" },
        { label: "Scheduled", value: "scheduled" },
      ],
    },
    {
      name: "maxItems",
      type: "number",
      required: false,
      defaultValue: 0,
      min: 0,
      max: 1000000,
      label: "Max Items for This Run",
      admin: {
        description: "0 means unlimited; otherwise limit per run",
      },
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "pending",
      label: "Status",
      options: [
        { label: "Pending", value: "pending" },
        { label: "Running", value: "running" },
        { label: "Paused", value: "paused" },
        { label: "Completed", value: "completed" },
        { label: "Error", value: "error" },
      ],
    },

    // Metrics
    {
      name: "counters",
      type: "json",
      label: "Counters",
      defaultValue: { found: 0, uploaded: 0, errors: 0 },
      admin: {
        description: "Real-time job metrics",
      },
    },

    // Timing
    {
      name: "startedAt",
      type: "date",
      label: "Started At",
      admin: {
        readOnly: true,
      },
    },
    {
      name: "completedAt",
      type: "date",
      label: "Completed At",
      admin: {
        readOnly: true,
      },
    },

    // Error Handling
    {
      name: "errorMessage",
      type: "textarea",
      label: "Error Message",
      admin: {
        condition: (data) => data.status === "error",
      },
    },
  ],
};
