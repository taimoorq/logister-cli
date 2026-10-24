// Project UUIDs and slugs become one API path segment, so "." and ".." must never reach the URL builder.
export const PROJECT_IDENTIFIER_MESSAGE = "Project identifiers must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens (at most 255 characters).";

export function validProjectIdentifier(value) {
  return typeof value === "string" && value.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}
