/**
 * Turning an agent's input schema into fields to fill in.
 *
 * Only worth doing for the shapes a form actually improves on: a flat object of
 * scalars. Anything nested, or any array of objects, is faster and clearer to
 * type as JSON than to click through a generated form, so those fall back
 * rather than growing a form builder nobody asked for.
 */

export interface InputField {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly required: boolean;
  readonly control: "text" | "number" | "checkbox" | "select";
  readonly options: readonly string[];
  readonly hasOptions: boolean;
  readonly placeholder: string;
  /** Composed here: an attribute holding an expression loses any literal beside it. */
  readonly inputId: string;
  readonly inputType: string;
  /** Description plus whatever else constrains the value, ready to render. */
  readonly note: string;
}

export interface InputForm {
  /** False when the schema is missing or too complex to be worth a form. */
  readonly usable: boolean;
  readonly fields: readonly InputField[];
  /** Why a form is not on offer, for the panel to explain rather than just omit it. */
  readonly reason: string;
}

export function inputForm(schema: unknown): InputForm {
  const s = asObject(schema);
  if (!s) {
    return {
      usable: false,
      fields: [],
      reason:
        "Nothing declares what this agent expects. `Session.run` takes any value, and only a `subAgent` wrapper describes an agent's input.",
    };
  }
  if (s["type"] !== "object") {
    return { usable: false, fields: [], reason: "The declared input is not an object." };
  }

  const properties = asObject(s["properties"]);
  const names = properties ? Object.keys(properties) : [];
  if (names.length === 0) {
    return { usable: false, fields: [], reason: "The declared input has no properties." };
  }

  const required = new Set(Array.isArray(s["required"]) ? (s["required"] as string[]) : []);
  const fields: InputField[] = [];

  for (const name of names) {
    const prop = asObject(properties![name]);
    if (!prop) return nested(name);
    const field = fieldFor(name, prop, required.has(name));
    if (!field) return nested(name);
    fields.push(field);
  }

  return { usable: true, fields, reason: "" };
}

function nested(name: string): InputForm {
  return {
    usable: false,
    fields: [],
    reason: `"${name}" is a nested or repeating value, which is quicker to type as JSON than to fill in.`,
  };
}

function fieldFor(name: string, prop: Record<string, unknown>, required: boolean): InputField | null {
  const description = typeof prop["description"] === "string" ? prop["description"] : "";
  const base = {
    name,
    label: name,
    description,
    required,
    // A description is the best placeholder there is: it is what the author
    // already wrote to explain the field.
    placeholder: description,
  };

  const enumValues = prop["enum"];
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    const options = enumValues.map(String);
    return {
      ...base,
      control: "select",
      options,
      hasOptions: true,
      inputId: `input-${name}`,
      inputType: "text",
      note: joinNote(description, `one of: ${options.join(", ")}`, required),
    };
  }

  const control = controlFor(prop["type"]);
  if (!control) return null;
  return {
    ...base,
    control,
    options: [],
    hasOptions: false,
    inputId: `input-${name}`,
    inputType: control === "number" ? "number" : control === "checkbox" ? "checkbox" : "text",
    note: joinNote(description, "", required),
  };
}

function controlFor(type: unknown): InputField["control"] | null {
  switch (type) {
    case "string":
      return "text";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "checkbox";
    default:
      return null;
  }
}

function joinNote(description: string, constraint: string, required: boolean): string {
  return [description, constraint, required ? "required" : ""].filter((p) => p.length > 0).join(" · ");
}

/**
 * Read the filled-in fields back into the object the run receives.
 *
 * An empty optional field is left out rather than sent as `""`: an absent
 * property and a present empty one mean different things to a schema, and the
 * model reads the difference too.
 */
export function readForm(
  fields: readonly InputField[],
  read: (name: string) => { value: string; checked: boolean } | null
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = read(f.name);
    if (!raw) continue;
    if (f.control === "checkbox") {
      out[f.name] = raw.checked;
      continue;
    }
    const text = raw.value.trim();
    if (text.length === 0) {
      if (f.required) out[f.name] = "";
      continue;
    }
    out[f.name] = f.control === "number" ? Number(text) : text;
  }
  return out;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
