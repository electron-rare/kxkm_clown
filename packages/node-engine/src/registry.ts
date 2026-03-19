export interface NodeParamDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "select";
  required: boolean;
  default?: unknown;
  options?: string[];
}

export interface NodeTypeDefinition {
  id: string;
  family: string;
  label: string;
  inputs: string[];
  outputs: string[];
  params: NodeParamDefinition[];
  runtimes: string[];
  description: string;
}

export interface FamilyMeta {
  id: string;
  label: string;
  description: string;
}

/**
 * Default node type definitions ported from V1 node-engine-registry.js.
 *
 * Each V1 entry is mapped as follows:
 *   type   -> id
 *   title  -> label
 *   inputs / outputs / runtimes / description -> kept as-is
 *   params -> explicit static schema for the React admin/editor layer
 */
const DEFAULT_NODE_TYPES: NodeTypeDefinition[] = [
  {
    id: "dataset_file",
    family: "dataset_source",
    label: "Dataset File",
    inputs: [],
    outputs: ["dataset"],
    params: [{ name: "path", type: "string", required: true }],
    runtimes: ["local_cpu", "local_gpu", "cloud_api"],
    description:
      "Load a local dataset from a JSON, JSONL, CSV or Parquet file.",
  },
  {
    id: "dataset_folder",
    family: "dataset_source",
    label: "Dataset Folder",
    inputs: [],
    outputs: ["dataset"],
    params: [{ name: "path", type: "string", required: true }],
    runtimes: ["local_cpu", "local_gpu"],
    description: "Aggregate a local directory of structured datasets.",
  },
  {
    id: "huggingface_dataset",
    family: "dataset_source",
    label: "HuggingFace Dataset",
    inputs: [],
    outputs: ["dataset"],
    params: [{ name: "repo", type: "string", required: true }],
    runtimes: ["cloud_api", "local_cpu", "local_gpu"],
    description: "Load a dataset from the Hugging Face Hub.",
  },
  {
    id: "web_scraper",
    family: "dataset_source",
    label: "Web Scraper",
    inputs: [],
    outputs: ["dataset"],
    params: [{ name: "url", type: "string", required: true }],
    runtimes: ["cloud_api", "local_cpu"],
    description: "Collect web documents and transform them into a dataset.",
  },
  {
    id: "clean_text",
    family: "data_processing",
    label: "Clean Text",
    inputs: ["dataset"],
    outputs: ["dataset"],
    params: [{ name: "trim", type: "boolean", required: false, default: true }],
    runtimes: ["local_cpu", "local_gpu", "cluster"],
    description: "Clean and normalise dataset text fields.",
  },
  {
    id: "remove_duplicates",
    family: "data_processing",
    label: "Remove Duplicates",
    inputs: ["dataset"],
    outputs: ["dataset"],
    params: [],
    runtimes: ["local_cpu", "local_gpu", "cluster"],
    description: "Deduplicate examples before preparation.",
  },
  {
    id: "split_dataset",
    family: "data_processing",
    label: "Split Dataset",
    inputs: ["dataset"],
    outputs: ["dataset"],
    params: [
      { name: "train", type: "number", required: false, default: 0.9 },
      { name: "test", type: "number", required: false, default: 0.1 },
    ],
    runtimes: ["local_cpu", "local_gpu", "cluster"],
    description: "Create train, validation and test splits.",
  },
  {
    id: "format_instruction_dataset",
    family: "dataset_builder",
    label: "Instruction Dataset",
    inputs: ["dataset"],
    outputs: ["dataset_ready"],
    params: [
      {
        name: "mode",
        type: "select",
        required: false,
        default: "chat",
        options: ["chat", "instruction"],
      },
    ],
    runtimes: ["local_cpu", "local_gpu", "cluster"],
    description: "Transform examples into an instruction/chat format.",
  },
  {
    id: "chat_dataset",
    family: "dataset_builder",
    label: "Chat Dataset",
    inputs: ["dataset"],
    outputs: ["dataset_ready"],
    params: [],
    runtimes: ["local_cpu", "local_gpu", "cluster"],
    description: "Build a multi-role message dataset.",
  },
  {
    id: "lora_training",
    family: "training",
    label: "LoRA Training",
    inputs: ["dataset_ready"],
    outputs: ["model"],
    params: [{ name: "baseModel", type: "string", required: true }],
    runtimes: ["local_gpu", "remote_gpu", "cluster"],
    description: "Run a LoRA fine-tuning pass on a base model.",
  },
  {
    id: "qlora_training",
    family: "training",
    label: "QLoRA Training",
    inputs: ["dataset_ready"],
    outputs: ["model"],
    params: [{ name: "baseModel", type: "string", required: true }],
    runtimes: ["local_gpu", "remote_gpu", "cluster"],
    description: "Run a QLoRA fine-tuning pass optimised for reduced VRAM.",
  },
  {
    id: "benchmark",
    family: "evaluation",
    label: "Benchmark",
    inputs: ["model", "dataset_ready"],
    outputs: ["evaluation"],
    params: [{ name: "suite", type: "string", required: false, default: "smoke" }],
    runtimes: ["local_cpu", "local_gpu", "cluster"],
    description: "Evaluate a model on a prompt set and metrics.",
  },
  {
    id: "prompt_test",
    family: "evaluation",
    label: "Prompt Test",
    inputs: ["model", "dataset_ready"],
    outputs: ["evaluation"],
    params: [
      { name: "prompt", type: "string", required: false },
      { name: "model", type: "string", required: false },
    ],
    runtimes: ["local_cpu", "local_gpu", "cloud_api"],
    description: "Test a model on a fixed prompt or a batch of prompts.",
  },
  {
    id: "register_model",
    family: "model_registry",
    label: "Register Model",
    inputs: ["model", "evaluation"],
    outputs: ["registered_model"],
    params: [{ name: "alias", type: "string", required: false, default: "candidate" }],
    runtimes: ["local_cpu", "cluster"],
    description: "Register a model with version, alias and metadata.",
  },
  {
    id: "deploy_api",
    family: "deployment",
    label: "Deploy API",
    inputs: ["registered_model"],
    outputs: ["deployment"],
    params: [
      {
        name: "target",
        type: "select",
        required: false,
        default: "local",
        options: ["local", "remote", "cluster", "cloud"],
      },
    ],
    runtimes: ["local_cpu", "remote_gpu", "cluster", "cloud_api"],
    description: "Publish a model via a local or remote API.",
  },
];

const DEFAULT_FAMILY_META: FamilyMeta[] = [
  {
    id: "dataset_source",
    label: "Dataset Source",
    description: "Loading and collecting raw data.",
  },
  {
    id: "data_processing",
    label: "Data Processing",
    description: "Cleaning, deduplication, splitting and transformations.",
  },
  {
    id: "dataset_builder",
    label: "Dataset Builder",
    description: "Preparing LLM training formats.",
  },
  {
    id: "training",
    label: "Training",
    description: "Fine-tuning, LoRA and QLoRA on a dedicated runtime target.",
  },
  {
    id: "evaluation",
    label: "Evaluation",
    description: "Benchmarks, prompt tests and human validation.",
  },
  {
    id: "model_registry",
    label: "Model Registry",
    description: "Versioning, traceability and model metadata.",
  },
  {
    id: "deployment",
    label: "Deployment",
    description: "Local, API, cluster or edge publication.",
  },
];

export interface NodeEngineRegistry {
  register(def: NodeTypeDefinition): void;
  getNodeType(id: string): NodeTypeDefinition | null;
  listNodeTypes(): NodeTypeDefinition[];
  listFamilies(): string[];
  getFamily(family: string): NodeTypeDefinition[];
}

export function createNodeEngineRegistry(): NodeEngineRegistry {
  const nodeTypes = new Map<string, NodeTypeDefinition>();
  const familyMeta = new Map<string, FamilyMeta>();

  for (const def of DEFAULT_NODE_TYPES) {
    nodeTypes.set(def.id, { ...def });
  }
  for (const meta of DEFAULT_FAMILY_META) {
    familyMeta.set(meta.id, { ...meta });
  }

  function register(def: NodeTypeDefinition): void {
    nodeTypes.set(def.id, { ...def });
    if (!familyMeta.has(def.family)) {
      familyMeta.set(def.family, {
        id: def.family,
        label: def.family,
        description: "",
      });
    }
  }

  return {
    register,
    getNodeType(id: string): NodeTypeDefinition | null {
      return nodeTypes.get(id) ?? null;
    },
    listNodeTypes(): NodeTypeDefinition[] {
      return Array.from(nodeTypes.values()).map((def) => ({ ...def }));
    },
    listFamilies(): string[] {
      return Array.from(familyMeta.keys());
    },
    getFamily(family: string): NodeTypeDefinition[] {
      return Array.from(nodeTypes.values())
        .filter((def) => def.family === family)
        .map((def) => ({ ...def }));
    },
  };
}
