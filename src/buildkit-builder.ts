import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import * as tls from '@pulumi/tls';

export interface BuildkitBuilderArgs {
  caCertPem: pulumi.Input<string>;
  certPem: pulumi.Input<string>;
  privateKeyPem: pulumi.Input<string>;
  replicas?: pulumi.Input<number>;
  namespace?: pulumi.Input<string>;
  pvConfig?: pulumi.Input<PvConfig>;
  nodeSelector?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
  tolerations?: pulumi.Input<k8s.types.input.core.v1.Toleration[]>;
  resources?: pulumi.Input<k8s.types.input.core.v1.ResourceRequirements>;
  hostname?: pulumi.Input<string>;
  serviceType?: pulumi.Input<string>;
  serviceAnnotations?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
}

export interface PvConfig {
  storageClass: string;
  size: string;
}

export class BuildkitBuilder extends pulumi.ComponentResource {
  constructor(
    name: string,
    args: BuildkitBuilderArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('docker-buildfarm:index:Builder', name, args, opts);

    // Create a Kubernetes namespace for buildkit resources
    const namespace = args.namespace ?? 'default'; // Using default namespace

    // Create a secret for buildkit certificates
    const certSecret = new k8s.core.v1.Secret(
      `${name}-buildkit-certs`,
      {
        metadata: {
          name: `${name}-buildkit-certs`,
          namespace: namespace,
        },
        stringData: {
          'ca.pem': args.caCertPem,
          'cert.pem': args.certPem,
          'key.pem': args.privateKeyPem,
        },
      },
      { parent: this },
    );

    const statefulSet = new k8s.apps.v1.StatefulSet(
      `${name}-buildkitd`,
      {
        metadata: {
          name: `${name}-buildkitd`,
          namespace: namespace,
          labels: {
            app: `${name}-buildkitd`,
          },
        },
        spec: {
          replicas: args.replicas ?? 1,
          selector: {
            matchLabels: {
              app: `${name}-buildkitd`,
            },
          },
          serviceName: `${name}-buildkitd`,
          template: {
            metadata: {
              labels: {
                app: `${name}-buildkitd`,
              },
            },
            spec: {
              nodeSelector: args.nodeSelector,
              tolerations: args.tolerations,
              containers: [
                {
                  name: 'buildkitd',
                  image: 'moby/buildkit:v0.20.1-rootless',
                  resources: args.resources,
                  args: [
                    '--addr',
                    'unix:///run/user/1000/buildkit/buildkitd.sock',
                    '--addr',
                    'tcp://0.0.0.0:1234',
                    '--tlscacert',
                    '/certs/ca.pem',
                    '--tlscert',
                    '/certs/cert.pem',
                    '--tlskey',
                    '/certs/key.pem',
                    '--oci-worker-no-process-sandbox',
                  ],
                  readinessProbe: {
                    exec: {
                      command: ['buildctl', 'debug', 'workers'],
                    },
                    initialDelaySeconds: 5,
                    periodSeconds: 30,
                  },
                  livenessProbe: {
                    exec: {
                      command: ['buildctl', 'debug', 'workers'],
                    },
                    initialDelaySeconds: 5,
                    periodSeconds: 30,
                  },
                  securityContext: {
                    seccompProfile: {
                      type: 'Unconfined',
                    },
                    appArmorProfile: {
                      type: 'Unconfined',
                    },
                    runAsUser: 1000,
                    runAsGroup: 1000,
                  },
                  ports: [
                    {
                      containerPort: 1234,
                    },
                  ],
                  volumeMounts: [
                    {
                      name: 'certs',
                      readOnly: true,
                      mountPath: '/certs',
                    },
                    {
                      name: 'buildkitd',
                      mountPath: '/home/user/.local/share/buildkit',
                    },
                  ],
                },
              ],
              volumes: [
                {
                  name: 'certs',
                  secret: {
                    secretName: certSecret.metadata.name,
                  },
                },
                ...(args.pvConfig
                  ? []
                  : [
                      {
                        name: 'buildkitd',
                        emptyDir: {},
                      },
                    ]),
              ],
            },
          },
          volumeClaimTemplates: args.pvConfig
            ? [
                {
                  metadata: {
                    name: 'buildkitd',
                  },
                  spec: {
                    accessModes: ['ReadWriteOnce'],
                    storageClassName: pulumi.output(args.pvConfig).storageClass,
                    resources: {
                      requests: {
                        storage: pulumi.output(args.pvConfig).size,
                      },
                    },
                  },
                },
              ]
            : undefined,
        },
      },
      { parent: this },
    );

    const service = new k8s.core.v1.Service(
      `${name}-buildkitd`,
      {
        metadata: {
          name: `${name}-buildkitd`,
          namespace: namespace,
          labels: {
            app: `${name}-buildkitd`,
          },
          annotations: pulumi
            .output(args.serviceAnnotations)
            .apply((annotations) => {
              if (args.hostname) {
                return {
                  'external-dns.alpha.kubernetes.io/hostname': args.hostname,
                  ...annotations,
                };
              } else {
                return annotations ?? {};
              }
            }),
        },
        spec: {
          ports: [
            {
              port: 1234,
              protocol: 'TCP',
            },
          ],
          type: args.serviceType ?? 'LoadBalancer',
          selector: {
            app: `${name}-buildkitd`,
          },
        },
      },
      { parent: this },
    );

    // Register outputs
    this.registerOutputs({
      statefulSet,
      service,
      certSecret,
    });
  }
}

export interface BuildkitCertsArgs {
  caSubject?: pulumi.Input<tls.types.input.SelfSignedCertSubject>;
  // The algorithm to use for the client/server certificates. Either "RSA" or "ECDSA".
  keyAlgorithm?: pulumi.Input<string>;
  serverIPAddresses?: pulumi.Input<pulumi.Input<string>[]>;
  serverDNSNames?: pulumi.Input<pulumi.Input<string>[]>;
}

export class BuildkitCerts extends pulumi.ComponentResource {
  public readonly caCertPublicKeyPem: pulumi.Output<string>;
  public readonly caCertPem: pulumi.Output<string>;
  public readonly serverCertPem: pulumi.Output<string>;
  public readonly serverPrivateKeyPem: pulumi.Output<string>;
  public readonly clientCertPem: pulumi.Output<string>;
  public readonly clientPrivateKeyPem: pulumi.Output<string>;

  constructor(
    name: string,
    args: BuildkitCertsArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('docker-buildfarm:index:Certs', name, args, opts);

    const pk = new tls.PrivateKey(`${name}-ca-key`, {
      algorithm: 'RSA',
      rsaBits: 3072,
    });

    this.caCertPublicKeyPem = pk.publicKeyPem;

    // certificate is valid for 800 days (2 years and 2 months), which is less than
    // 825 days, the limit that macOS/iOS apply to all certificates,
    // including custom roots. See https://support.apple.com/en-us/HT210176.
    // validityPeriodHours: 800 * 24,
    const ca = new tls.SelfSignedCert('ca', {
      privateKeyPem: pk.privateKeyPem,
      allowedUses: ['cert_signing'],
      validityPeriodHours: 10 * 365 * 24, // 10 years
      earlyRenewalHours: 90 * 24, // 90 days
      isCaCertificate: true,
      setSubjectKeyId: true,
      subject: args.caSubject ?? {
        commonName: 'buildkit-ca',
        organization: 'Buildkit development CA',
      },
    });

    const keyArgs = {
      algorithm: args.keyAlgorithm ?? 'RSA',
      rsaBits: pulumi.output(args.keyAlgorithm).apply((algorithm) => {
        if (algorithm === 'RSA') {
          return 2048;
        }
        return undefined as any;
      }),
      ecdsaCurve: pulumi.output(args.keyAlgorithm).apply((algorithm) => {
        if (algorithm === 'ECDSA') {
          return 'P256';
        }
        return undefined as any;
      }),
    };

    // Create server key and certificate
    const serverKey = new tls.PrivateKey(`${name}-server-key`, keyArgs);
    const serverCertRequest = new tls.CertRequest(
      `${name}-server-cert-request`,
      {
        privateKeyPem: serverKey.privateKeyPem,
        subject: {
          organization: 'Buildkit development certificate',
        },
        dnsNames: args.serverDNSNames,
        ipAddresses: args.serverIPAddresses,
      },
    );
    const serverCert = new tls.LocallySignedCert(`${name}-server-cert`, {
      caPrivateKeyPem: ca.privateKeyPem,
      caCertPem: ca.certPem,
      certRequestPem: serverCertRequest.certRequestPem,
      allowedUses: ['key_encipherment', 'digital_signature', 'server_auth'],
      validityPeriodHours: 800 * 24, // 800 days (compliant with Apple's limit)
    });

    // Create client key and certificate
    const clientKey = new tls.PrivateKey(`${name}-client-key`, keyArgs);
    const clientCertRequest = new tls.CertRequest(
      `${name}-client-cert-request`,
      {
        privateKeyPem: clientKey.privateKeyPem,
        subject: {
          organization: 'Buildkit development certificate',
        },
      },
    );
    const clientCert = new tls.LocallySignedCert(`${name}-client-cert`, {
      caPrivateKeyPem: ca.privateKeyPem,
      caCertPem: ca.certPem,
      certRequestPem: clientCertRequest.certRequestPem,
      allowedUses: ['key_encipherment', 'digital_signature', 'client_auth'],
      validityPeriodHours: 800 * 24, // 800 days (compliant with Apple's limit)
    });

    // Export the certificates and keys as class properties
    this.caCertPem = ca.certPem;
    this.serverCertPem = serverCert.certPem;
    this.serverPrivateKeyPem = serverKey.privateKeyPem;
    this.clientCertPem = clientCert.certPem;
    this.clientPrivateKeyPem = clientKey.privateKeyPem;

    // Register all resources
    this.registerOutputs({
      caCertPem: this.caCertPem,
      serverCertPem: this.serverCertPem,
      serverPrivateKeyPem: this.serverPrivateKeyPem,
      clientCertPem: this.clientCertPem,
      clientPrivateKeyPem: this.clientPrivateKeyPem,
    });
  }
}
