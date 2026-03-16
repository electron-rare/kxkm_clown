function createNodeEngineRegistry() {
  const nodeTypes = [
    {
      type: "dataset_file",
      family: "dataset_source",
      title: "Dataset File",
      inputs: [],
      outputs: ["dataset"],
      runtimes: ["local_cpu", "local_gpu", "cloud_api"],
      description: "Charge un dataset local depuis un fichier JSON, JSONL, CSV ou Parquet.",
    },
    {
      type: "dataset_folder",
      family: "dataset_source",
      title: "Dataset Folder",
      inputs: [],
      outputs: ["dataset"],
      runtimes: ["local_cpu", "local_gpu"],
      description: "Agrège un répertoire local de datasets structurés.",
    },
    {
      type: "huggingface_dataset",
      family: "dataset_source",
      title: "HuggingFace Dataset",
      inputs: [],
      outputs: ["dataset"],
      runtimes: ["cloud_api", "local_cpu", "local_gpu"],
      description: "Charge un dataset depuis le Hub Hugging Face.",
    },
    {
      type: "web_scraper",
      family: "dataset_source",
      title: "Web Scraper",
      inputs: [],
      outputs: ["dataset"],
      runtimes: ["cloud_api", "local_cpu"],
      description: "Collecte des documents web à transformer en dataset.",
    },
    {
      type: "clean_text",
      family: "data_processing",
      title: "Clean Text",
      inputs: ["dataset"],
      outputs: ["dataset"],
      runtimes: ["local_cpu", "local_gpu", "cluster"],
      description: "Nettoie et normalise les textes du dataset.",
    },
    {
      type: "remove_duplicates",
      family: "data_processing",
      title: "Remove Duplicates",
      inputs: ["dataset"],
      outputs: ["dataset"],
      runtimes: ["local_cpu", "local_gpu", "cluster"],
      description: "Déduplique les exemples avant préparation.",
    },
    {
      type: "split_dataset",
      family: "data_processing",
      title: "Split Dataset",
      inputs: ["dataset"],
      outputs: ["dataset"],
      runtimes: ["local_cpu", "local_gpu", "cluster"],
      description: "Crée les splits train, validation et test.",
    },
    {
      type: "format_instruction_dataset",
      family: "dataset_builder",
      title: "Instruction Dataset",
      inputs: ["dataset"],
      outputs: ["dataset_ready"],
      runtimes: ["local_cpu", "local_gpu", "cluster"],
      description: "Transforme les exemples vers un format instruction/chat.",
    },
    {
      type: "chat_dataset",
      family: "dataset_builder",
      title: "Chat Dataset",
      inputs: ["dataset"],
      outputs: ["dataset_ready"],
      runtimes: ["local_cpu", "local_gpu", "cluster"],
      description: "Construit un dataset de messages multi-rôles.",
    },
    {
      type: "lora_training",
      family: "training",
      title: "LoRA Training",
      inputs: ["dataset_ready"],
      outputs: ["model"],
      runtimes: ["local_gpu", "remote_gpu", "cluster"],
      description: "Lance un fine-tuning LoRA sur un modèle de base.",
    },
    {
      type: "qlora_training",
      family: "training",
      title: "QLoRA Training",
      inputs: ["dataset_ready"],
      outputs: ["model"],
      runtimes: ["local_gpu", "remote_gpu", "cluster"],
      description: "Lance un fine-tuning QLoRA orienté VRAM réduite.",
    },
    {
      type: "benchmark",
      family: "evaluation",
      title: "Benchmark",
      inputs: ["model", "dataset_ready"],
      outputs: ["evaluation"],
      runtimes: ["local_cpu", "local_gpu", "cluster"],
      description: "Évalue un modèle sur un jeu de prompts et de métriques.",
    },
    {
      type: "prompt_test",
      family: "evaluation",
      title: "Prompt Test",
      inputs: ["model", "dataset_ready"],
      outputs: ["evaluation"],
      runtimes: ["local_cpu", "local_gpu", "cloud_api"],
      description: "Teste un modèle sur un prompt fixe ou un lot de prompts.",
    },
    {
      type: "register_model",
      family: "model_registry",
      title: "Register Model",
      inputs: ["model", "evaluation"],
      outputs: ["registered_model"],
      runtimes: ["local_cpu", "cluster"],
      description: "Enregistre un modèle avec version, alias et métadonnées.",
    },
    {
      type: "deploy_api",
      family: "deployment",
      title: "Deploy API",
      inputs: ["registered_model"],
      outputs: ["deployment"],
      runtimes: ["local_cpu", "remote_gpu", "cluster", "cloud_api"],
      description: "Publie un modèle via une API locale ou distante.",
    },
  ];

  const familyMeta = {
    dataset_source: {
      title: "Dataset Source",
      description: "Chargement et collecte des données brutes.",
    },
    data_processing: {
      title: "Data Processing",
      description: "Nettoyage, déduplication, découpage et transformations.",
    },
    dataset_builder: {
      title: "Dataset Builder",
      description: "Préparation des formats d'entraînement pour LLM.",
    },
    training: {
      title: "Training",
      description: "Fine-tuning, LoRA et QLoRA sur une cible runtime dédiée.",
    },
    evaluation: {
      title: "Evaluation",
      description: "Benchmarks, tests de prompts et validation humaine.",
    },
    model_registry: {
      title: "Model Registry",
      description: "Versioning, traçabilité et métadonnées de modèles.",
    },
    deployment: {
      title: "Deployment",
      description: "Publication locale, API, cluster ou edge.",
    },
  };

  function listNodeTypes() {
    return nodeTypes.map((node) => ({ ...node }));
  }

  function getNodeType(type) {
    return nodeTypes.find((node) => node.type === type) || null;
  }

  function listFamilies() {
    return Object.entries(familyMeta).map(([id, meta]) => ({
      id,
      ...meta,
      count: nodeTypes.filter((node) => node.family === id).length,
    }));
  }

  function buildSeedGraphTemplate() {
    return listSeedGraphs()[0];
  }

  function listSeedGraphs() {
    return [
      {
      id: "starter_llm_training",
      name: "Starter LoRA Training",
      description: "Pipeline seed: dataset local -> nettoyage -> split -> format instruction -> LoRA -> benchmark -> registry -> deploy.",
      runtime: "local_gpu",
      tags: ["seed", "training", "lora"],
      nodes: [
        { id: "source", type: "dataset_file", title: "Dataset File", params: { path: "docs/examples/node_engine_dataset.jsonl" }, runtime: "local_cpu" },
        { id: "clean", type: "clean_text", title: "Clean Text", params: { trim: true }, runtime: "local_cpu" },
        { id: "split", type: "split_dataset", title: "Split Dataset", params: { train: 0.9, test: 0.1 }, runtime: "local_cpu" },
        { id: "format", type: "format_instruction_dataset", title: "Instruction Dataset", params: { mode: "chat" }, runtime: "local_cpu" },
        { id: "train", type: "lora_training", title: "LoRA Training", params: { baseModel: "mistral:7b" }, runtime: "local_gpu" },
        { id: "benchmark", type: "benchmark", title: "Benchmark", params: { suite: "smoke" }, runtime: "local_cpu" },
        { id: "register", type: "register_model", title: "Register Model", params: { alias: "candidate" }, runtime: "local_cpu" },
        { id: "deploy", type: "deploy_api", title: "Deploy API", params: { target: "local" }, runtime: "local_cpu" },
      ],
      edges: [
        { from: { node: "source", output: "dataset" }, to: { node: "clean", input: "dataset" } },
        { from: { node: "clean", output: "dataset" }, to: { node: "split", input: "dataset" } },
        { from: { node: "split", output: "dataset" }, to: { node: "format", input: "dataset" } },
        { from: { node: "format", output: "dataset_ready" }, to: { node: "train", input: "dataset_ready" } },
        { from: { node: "train", output: "model" }, to: { node: "benchmark", input: "model" } },
        { from: { node: "train", output: "model" }, to: { node: "register", input: "model" } },
        { from: { node: "benchmark", output: "evaluation" }, to: { node: "register", input: "evaluation" } },
        { from: { node: "register", output: "registered_model" }, to: { node: "deploy", input: "registered_model" } },
      ],
      },
      {
        id: "starter_local_eval",
        name: "Starter Local Eval",
        description: "Pipeline local réel: dataset -> préparation -> prompt test -> benchmark -> registry -> deploy.",
        runtime: "local_cpu",
        tags: ["seed", "local", "evaluation"],
        nodes: [
          { id: "source", type: "dataset_file", title: "Dataset File", params: { path: "docs/examples/node_engine_dataset.jsonl" }, runtime: "local_cpu" },
          { id: "clean", type: "clean_text", title: "Clean Text", params: { trim: true }, runtime: "local_cpu" },
          { id: "split", type: "split_dataset", title: "Split Dataset", params: { train: 0.8, test: 0.2 }, runtime: "local_cpu" },
          { id: "format", type: "format_instruction_dataset", title: "Instruction Dataset", params: { mode: "chat" }, runtime: "local_cpu" },
          { id: "prompt", type: "prompt_test", title: "Prompt Test", params: { model: "mistral:7b", prompt: "Resume le ton du dataset." }, runtime: "local_cpu" },
          { id: "benchmark", type: "benchmark", title: "Benchmark", params: { model: "mistral:7b" }, runtime: "local_cpu" },
          { id: "register", type: "register_model", title: "Register Model", params: { alias: "starter_local_eval", model: "mistral:7b" }, runtime: "local_cpu" },
          { id: "deploy", type: "deploy_api", title: "Deploy API", params: { target: "local" }, runtime: "local_cpu" },
        ],
        edges: [
          { from: { node: "source", output: "dataset" }, to: { node: "clean", input: "dataset" } },
          { from: { node: "clean", output: "dataset" }, to: { node: "split", input: "dataset" } },
          { from: { node: "split", output: "dataset" }, to: { node: "format", input: "dataset" } },
          { from: { node: "format", output: "dataset_ready" }, to: { node: "prompt", input: "dataset_ready" } },
          { from: { node: "format", output: "dataset_ready" }, to: { node: "benchmark", input: "dataset_ready" } },
          { from: { node: "benchmark", output: "evaluation" }, to: { node: "register", input: "evaluation" } },
          { from: { node: "register", output: "registered_model" }, to: { node: "deploy", input: "registered_model" } },
        ],
      },
    ];
  }

  return {
    listNodeTypes,
    getNodeType,
    listFamilies,
    buildSeedGraphTemplate,
    listSeedGraphs,
  };
}

module.exports = {
  createNodeEngineRegistry,
};
