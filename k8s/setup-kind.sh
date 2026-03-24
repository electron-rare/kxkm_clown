#!/bin/bash
# =============================================================================
# KXKM Clown — Kind/Minikube Setup for Tower
# Run on tower: bash k8s/setup-kind.sh
# =============================================================================

set -e

echo "╔══════════════════════════════════════╗"
echo "║  KXKM K8s Setup (Kind)              ║"
echo "╚══════════════════════════════════════╝"

# --- 1. Install Kind ---
if ! command -v kind &>/dev/null; then
  echo "▸ Installing Kind..."
  curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.27.0/kind-linux-amd64
  chmod +x ./kind
  sudo mv ./kind /usr/local/bin/kind
fi
echo "  Kind: $(kind version)"

# --- 2. Install kubectl ---
if ! command -v kubectl &>/dev/null; then
  echo "▸ Installing kubectl..."
  curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
  chmod +x kubectl
  sudo mv kubectl /usr/local/bin/kubectl
fi
echo "  kubectl: $(kubectl version --client --short 2>/dev/null)"

# --- 3. Create cluster ---
echo "▸ Creating Kind cluster 'kxkm'..."
cat <<EOF | kind create cluster --name kxkm --config=-
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30333
        hostPort: 3333
        protocol: TCP
      - containerPort: 30080
        hostPort: 80
        protocol: TCP
EOF

echo "▸ Cluster ready:"
kubectl cluster-info --context kind-kxkm

# --- 4. Create namespace ---
kubectl create namespace kxkm 2>/dev/null || true
kubectl config set-context --current --namespace=kxkm

# --- 5. Create secrets ---
echo "▸ Creating secrets..."
kubectl create secret generic kxkm-secrets \
  --from-literal=ADMIN_TOKEN=kxkm \
  --from-literal=MASCARADE_API_KEY=5bd6e38378b371c6b627ba5e78821eefd971abf10b515f34b840f00c2f156eb9 \
  --from-literal=MASCARADE_URL=http://kxkm-ai:8100 \
  --from-literal=OLLAMA_URL=http://kxkm-ai:11434 \
  --from-literal=KOKORO_URL=http://kxkm-ai:9201 \
  --from-literal=AI_BRIDGE_URL=http://kxkm-ai:8301 \
  -n kxkm 2>/dev/null || true

echo ""
echo "▸ Apply manifests:"
echo "  kubectl apply -f k8s/manifests/"
echo ""
echo "Done. Cluster 'kxkm' ready."
