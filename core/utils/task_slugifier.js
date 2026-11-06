function slugifyTask(input, options = {}) {
  // Handle null, undefined, or non-string inputs
  if (input === null || input === undefined || typeof input !== 'string') {
    return '';
  }

  const {
    preserveCase = false,
    maxLength = 64,
    prefix = undefined,
    separator = '-'
  } = options;

  // Convert to lowercase if preserveCase is false
  let slug = preserveCase ? input : input.toLowerCase();

  // Replace non-alphanumeric characters with separator
  slug = slug.replace(/[^a-z0-9]/gi, separator);

  // Collapse multiple consecutive separators
  const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const multiSeparatorRegex = new RegExp(`${escapedSeparator}{2,}`, 'g');
  slug = slug.replace(multiSeparatorRegex, separator);

  // Strip leading and trailing separators
  const trimRegex = new RegExp(`^${escapedSeparator}+|${escapedSeparator}+$`, 'g');
  slug = slug.replace(trimRegex, '');

  // Add prefix if provided
  if (prefix !== undefined && prefix !== null && prefix !== '') {
    // Only add separator if prefix doesn't already end with one
    const prefixEndsWithSeparator = prefix.endsWith(separator);
    slug = prefixEndsWithSeparator ? prefix + slug : prefix + separator + slug;
  }

  // Enforce maxLength truncation cleanly
  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength);
    // Remove trailing separator if present after truncation
    slug = slug.replace(new RegExp(`${escapedSeparator}+$`), '');
  }

  return slug;
}

module.exports = slugifyTask;
module.exports.slugifyTask = slugifyTask;
