import * as pulumi from '@pulumi/pulumi';

/**
 * Input arguments to the component
 */
export interface ExampleComponentArgs {
  // Component inputs...
}

/**
 * An example component
 */
export class ExampleComponent extends pulumi.ComponentResource {
  // Component outputs
  // public readonly roleArn: pulumi.Output<string>;

  constructor(
    name: string,
    args: ExampleComponentArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    // type has the format of ${package}:index:${className}
    // where package needs to match the `name` in your package.json
    // and className needs to match the name of this class
    super('aws-policies:index:ExampleComponent', name, args, opts);

    // Component resources go here...
    //
    // e.g.
    //
    // const role = new aws.iam.Role(
    //   `${name}-policy`,
    //   {
    //     assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal(
    //       aws.iam.Principals.LambdaPrincipal,
    //     ),
    //   },
    //   { parent: this },
    // );

    // register any of the component outputs here as well
    this.registerOutputs({
      // e.g.
      // roleArn: role.arn,
    });
  }
}
