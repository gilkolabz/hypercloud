/**
 * Strip legacy project names from hostpark HTMF content.
 * Hypothetical example product: clinicnotes @ opry/devops/clinicnotes
 */
const EXAMPLE_PRODUCT = "clinicnotes";
const EXAMPLE_PREFIX = "opry/devops/clinicnotes";

export function sanitizeParkHtml(html) {
  let s = String(html);

  // External flowerpot URLs → logical routes
  s = s.replace(
    /https:\/\/foobarch\.net\/flowerpot\/torus\/A_devops\/allenvethosp\/([^"<]+)/gi,
    `${EXAMPLE_PREFIX}/$1`
  );
  s = s.replace(
    /https:\/\/foobarch\.net\/flowerpot\/[^"<]+/gi,
    (url) => url.replace(/^https:\/\/foobarch\.net\/flowerpot\//i, "")
  );

  // Paths (longest first)
  s = s.replace(/torus\/A_devops\/allenvethosp/gi, EXAMPLE_PREFIX);
  s = s.replace(/A_devops\/allenvethosp/gi, EXAMPLE_PREFIX);
  s = s.replace(/\/flowerpot\/torus\/A_devops\/allenvethosp/gi, `/${EXAMPLE_PREFIX}`);
  s = s.replace(/torus\/A_devops\/\{project\}/gi, "C_devops/opryland/{project}");
  s = s.replace(/A_devops\/\{project\}/gi, "C_devops/opryland/{project}");
  s = s.replace(/A_devops\/\{name\}/gi, "C_devops/opryland/{name}");
  s = s.replace(/A_devops\/_build_folder\.mjs/gi, "C_devops/opryland/_build_folder.mjs");
  s = s.replace(/A_devops\/flowerpot_manifest\.json/gi, "project/flowerpot_manifest.json");
  s = s.replace(/torus\/A_devops/gi, "C_devops/opryland");
  s = s.replace(/A_devops\//gi, "C_devops/opryland/");

  // Product namespace
  s = s.replace(/allenvethosp/gi, EXAMPLE_PRODUCT);

  // Changelog lines that named the old tree
  s = s.replace(/torus\/A_document, torus\/A_devops/gi, "hostpark catalogs");

  return s;
}
