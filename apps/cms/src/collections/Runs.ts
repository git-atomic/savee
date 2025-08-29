import type { CollectionConfig } from "payload";

export const Runs: CollectionConfig = {
  slug: "runs",
  admin: {
    useAsTitle: "id",
    defaultColumns: [
      "id",
      "source",
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
      required: true,
      defaultValue: 50,
      min: 1,
      max: 1000,
      label: "Max Items for This Run",
      admin: {
        description: "Maximum number of items to scrape in this specific run",
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
