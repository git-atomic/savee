import type { CollectionConfig } from "payload";

export const Blocks: CollectionConfig = {
  slug: "blocks",
  admin: {
    useAsTitle: "title",
    defaultColumns: [
      "title",
      "mediaType",
      "status",
      "source",
      "run",
      "createdAt",
    ],
    description: "Individual scraped content blocks from Savee.it",
  },
  access: {
    read: () => true,
    create: () => true,
    update: () => true,
    delete: () => true,
  },
  fields: [
    // External Reference
    {
      name: "externalId",
      type: "text",
      required: true,
      unique: true,
      label: "External ID",
      admin: {
        description: "Unique identifier from Savee.it",
      },
    },

    // Relationships (source info available via relationships)
    {
      name: "source",
      type: "relationship",
      relationTo: "sources",
      required: true,
      label: "Source",
    },
    {
      name: "run",
      type: "relationship",
      relationTo: "runs",
      required: true,
      label: "Run",
    },

    // Content Info
    {
      name: "url",
      type: "text",
      required: true,
      label: "Content URL",
    },
    {
      name: "title",
      type: "text",
      label: "Title",
    },
    {
      name: "description",
      type: "textarea",
      label: "Description",
    },

    // Media Information
    {
      name: "mediaType",
      type: "select",
      label: "Media Type",
      options: [
        { label: "Image", value: "image" },
        { label: "Video", value: "video" },
        { label: "GIF", value: "gif" },
        { label: "Unknown", value: "unknown" },
      ],
    },
    {
      name: "imageUrl",
      type: "text",
      label: "Image URL",
    },
    {
      name: "videoUrl",
      type: "text",
      label: "Video URL",
    },
    {
      name: "thumbnailUrl",
      type: "text",
      label: "Thumbnail URL",
    },
    {
      name: "originalSourceUrl",
      type: "text",
      label: "Original Source URL",
      admin: {
        description: "Original URL where this content was found",
      },
    },

    // Status and Processing
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "pending",
      label: "Status",
      options: [
        { label: "Pending", value: "pending" },
        { label: "Fetched", value: "fetched" },
        { label: "Scraped", value: "scraped" },
        { label: "Uploaded", value: "uploaded" },
        { label: "Error", value: "error" },
      ],
    },

    // Metadata
    {
      name: "tags",
      type: "json",
      label: "Content Tags",
    },
    {
      name: "metadata",
      type: "json",
      label: "Additional Metadata",
    },

    // Storage
    {
      name: "r2Key",
      type: "text",
      label: "R2 Storage Key",
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
