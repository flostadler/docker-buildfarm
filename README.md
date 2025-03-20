# Docker Buildfarm

This is a Pulumi component that creates a buildkit build farm on Kubernetes.

You can use it like this:
```ts
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { BuildkitBuilder, BuildkitCerts } from "@pulumi/docker-buildfarm";

const config = new pulumi.Config();
const hostname = config.require("hostname");

const kube = new k8s.Provider("kube");
const buildkitNs = new k8s.core.v1.Namespace(
  "buildkit",
  {
    metadata: {
      name: "buildkit",
    },
  },
  {
    provider: kube,
  }
);
const buildkitCerts = new BuildkitCerts(
  "buildkit-certs",
  {
    serverDNSNames: [
      `buildkit.${hostname}`,
      // in cluster access (in case that's ever needed)
      `builder-buildkitd.${buildkitNs.metadata.name}.svc`,
    ],
    // for port forwarding to work as well
    serverIPAddresses: ["127.0.0.1"],
  },
  {
    providers: [kube],
  }
);

const buildkitBuilder = new BuildkitBuilder(
  "builder",
  {
    namespace: buildkitNs.metadata.name,
    caCertPem: buildkitCerts.caCertPem,
    certPem: buildkitCerts.serverCertPem,
    privateKeyPem: buildkitCerts.serverPrivateKeyPem,
    pvConfig: {
      // Switch this to an appropriate storage class for your cluster
      storageClass: "local-path",
      size: "100Gi",
    },
    hostname: `buildkit.${hostname}`,
    resources: {
      requests: {
        cpu: "4000m",
        memory: "16Gi",
      },
      limits: {
        memory: "16Gi",
      },
    },
  },
  {
    providers: [kube],
  }
);

export const buildkitClientPrivateKey = buildkitCerts.clientPrivateKeyPem;
export const buildkitClientCert = buildkitCerts.clientCertPem;
export const buildkitCaCert = buildkitCerts.caCertPem;
```

After deploying this, you can set up the remote builder like this:
```bash
# Get the certs
pulumi stack output buildkitCaCert --show-secrets > buildkitCaCert.pem
pulumi stack output buildkitClientCert --show-secrets > buildkitClientCert.pem
pulumi stack output buildkitClientPrivateKey --show-secrets > buildkitClientPrivateKey.pem

# Set up the remote builder
docker buildx create --name my-awesome-builder --use \
  --driver remote --platform linux/amd64 \
  --driver-opt key=$PWD/buildkitClientPrivateKey.pem,cert=$PWD/buildkitClientCert.pem,cacert=$PWD/buildkitCaCert.pem \
  tcp://${HOSTNAME}:1234
```
