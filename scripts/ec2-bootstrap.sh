#!/usr/bin/env bash
# One-time setup for a fresh EC2 instance: Docker, kubectl, kind.
# Supports Ubuntu/Debian (apt) and Amazon Linux 2023 (dnf).
# Usage: ./scripts/ec2-bootstrap.sh
set -euo pipefail

KIND_VERSION="v0.27.0"
KUBECTL_VERSION="v1.31.0"

echo "==> Installing Docker"
if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y docker
else
    echo "Unsupported distro: need apt-get or dnf" >&2
    exit 1
fi

sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

echo "==> Installing kubectl ${KUBECTL_VERSION}"
curl -fsSLO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/kubectl

echo "==> Installing kind ${KIND_VERSION}"
curl -fsSLo ./kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-amd64"
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind

echo
echo "Done. Log out and back in (or run 'newgrp docker') so your shell picks up"
echo "docker group membership, then run: ./scripts/deploy.sh"
