import type { CollectionConfig } from "payload";

export const Sources: CollectionConfig = {
  slug: "sources",
  admin: {
    useAsTitle: "url",
    defaultColumns: ["url", "sourceType", "username", "status"],
    description: "Source URLs for scraping content from Savee.it",
  },
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
    delete: () => true,
  },
  fields: [
    // Core Info (essential only)
    {
      name: "url",
      type: "text",
      required: true,
      unique: true,
      label: "Source URL",
      admin: {
        description: "Full URL to scrape content from",
      },
    },
    {
      name: "sourceType",
      type: "select",
      required: true,
      label: "Source Type",
      options: [
        { label: "Home Feed", value: "home" },
        { label: "Popular Content", value: "pop" },
        { label: "User Profile", value: "user" },
      ],
    },
    {
      name: "username",
      type: "text",
      label: "Username",
      admin: {
        condition: (data) => data.sourceType === "user",
        description: "Username for user profile sources",
      },
    },

    // Status Management
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "active",
      label: "Status",
      options: [
        { label: "Active", value: "active" },
        { label: "Paused", value: "paused" },
        { label: "Completed", value: "completed" },
        { label: "Error", value: "error" },
      ],
    },
  ],
  hooks: {
    beforeChange: [
      ({ data }) => {
        // Auto-set username from URL for user sources
        if (data.sourceType === "user" && data.url && !data.username) {
          const urlMatch = data.url.match(/savee\.(it|com)\/([^\/\?]+)/);
          if (urlMatch) {
            data.username = urlMatch[2]; // Second capture group now contains the username
          }
        }
        return data;
      },
    ],
  },
};
