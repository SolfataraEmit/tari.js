//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { TransactionRequest } from "./TransactionRequest";
import { TransactionArg } from "@tari-project/tarijs-types";
import {
  Amount,
  ComponentAddress,
  ConfidentialClaim,
  ConfidentialWithdrawProof,
  Instruction,
  ResourceAddress,
  SubstateRequirement,
  Transaction,
  TransactionSignature,
  UnsignedTransaction,
  PublishedTemplateAddress,
  WorkspaceOffsetId,
  UnsignedTransactionV1, AllocatableAddressType,
} from "@tari-project/typescript-bindings";
import { parseWorkspaceStringKey } from "../helpers";
import { NamedArg } from "../helpers/workspace";

export interface TransactionConstructor {
  new(unsignedTransaction: UnsignedTransaction, signatures: TransactionSignature[]): Transaction;
}

export interface TariFunctionDefinition {
  functionName: string;
  args?: NamedArg[];
  templateAddress: PublishedTemplateAddress;
}

export interface TariMethodDefinition {
  methodName: string;
  args?: TransactionArg[];
  // These are mutually exclusive i.e. either componentAddress or fromWorkspace (TODO: define this properly in typescript)
  componentAddress?: ComponentAddress;
  fromWorkspace?: string,
}

export interface TariCreateAccountDefinition {
  methodName: string;
  args?: {
    ownerPublicKey: string;
    workspaceBucket?: string;
  };
}

export interface Builder {
  callFunction<T extends TariFunctionDefinition>(func: T, args: Exclude<T["args"], undefined>): this;

  callMethod<T extends TariMethodDefinition>(method: T, args: Exclude<T["args"], undefined>): this;

  createAccount(ownerPublicKey: string, workspaceBucket?: string): this;

  createProof(account: ComponentAddress, resourceAddress: ResourceAddress): this;

  saveVar(key: string): this;

  dropAllProofsInWorkspace(): this;

  claimBurn(claim: ConfidentialClaim): this;

  addInput(inputObject: SubstateRequirement): this;

  addInstruction(instruction: Instruction): this;

  addFeeInstruction(instruction: Instruction): this;

  withMinEpoch(minEpoch: number): this;

  withMaxEpoch(maxEpoch: number): this;

  withInputs(inputs: SubstateRequirement[]): this;

  withInstructions(instructions: Instruction[]): this;

  withFeeInstructions(instructions: Instruction[]): this;

  withFeeInstructionsBuilder(builder: (builder: TransactionBuilder) => this): this;

  withUnsignedTransaction(unsignedTransaction: UnsignedTransactionV1): this;

  feeTransactionPayFromComponent(componentAddress: ComponentAddress, maxFee: string): this;

  feeTransactionPayFromComponentConfidential(
    componentAddress: ComponentAddress,
    proof: ConfidentialWithdrawProof,
  ): this;

  buildUnsignedTransaction(): UnsignedTransactionV1;

  build(): Transaction;
}

export class TransactionBuilder implements Builder {
  private unsignedTransaction: UnsignedTransactionV1;
  private signatures: TransactionSignature[];
  private allocatedIds: Map<string, number>;
  private current_id: number;

  constructor(network: number) {
    this.unsignedTransaction = {
      network,
      fee_instructions: [],
      instructions: [],
      inputs: [],
      min_epoch: null,
      max_epoch: null,
      dry_run: false,
      is_seal_signer_authorized: false
    };
    this.signatures = [];
    this.allocatedIds = new Map();
    this.current_id = 0;
  }

  public callFunction<T extends TariFunctionDefinition>(func: T, args: Exclude<T["args"], undefined>): this {
    const resolvedArgs = this.resolveArgs(args);
    return this.addInstruction({
      CallFunction: {
        address: func.templateAddress,
        function: func.functionName,
        args: resolvedArgs,
      },
    });
  }

  public callMethod<T extends TariMethodDefinition>(method: T, args: Exclude<T["args"], undefined>): this {
    const call = method.componentAddress ?
      { Address: method.componentAddress } :
      // NOTE: offset IDs are not supported for method calls
      { Workspace: this.getNamedId(method.fromWorkspace!)! };
    const resolvedArgs = this.resolveArgs(args);
    return this.addInstruction({
      CallMethod: {
        call,
        method: method.methodName,
        args: resolvedArgs,
      },
    });
  }

  public createAccount(ownerPublicKey: string, workspaceBucket?: string): this {
    const workspace_id = workspaceBucket ?
      this.getOffsetIdFromWorkspaceName(workspaceBucket) :
      null;

    return this.addInstruction({
      CreateAccount: {
        public_key_address: ownerPublicKey,
        owner_rule: null, // Custom owner rule is not set by default
        access_rules: null, // Custom access rules are not set by default
        workspace_id,
      },
    });
  }

  public createProof(account: ComponentAddress, resourceAddress: ResourceAddress): this {
    return this.addInstruction({
      CallMethod: {
        call: {Address: account},
        method: "create_proof_for_resource",
        args: [resourceAddress],
      },
    });
  }

  public claimBurn(claim: ConfidentialClaim): this {
    return this.addInstruction({
      ClaimBurn: {
        claim,
      },
    });
  }

  public allocateAddress(allocatableType: AllocatableAddressType, workspaceId: string): this {
    const workspace_id = this.addNamedId(workspaceId);
    return this.addInstruction({
      AllocateAddress: {
        allocatable_type: allocatableType,
        workspace_id,
      },
    });
  }

  public assertBucketContains(workspaceName: string, resource_address: ResourceAddress, min_amount: Amount): this {
    const key = this.getOffsetIdFromWorkspaceName(workspaceName);
    return this.addInstruction({
      AssertBucketContains: {
        key,
        resource_address,
        min_amount,
      },
    });
  }

  /**
   * The `SaveVar` method replaces
   * `PutLastInstructionOutputOnWorkspace: { key: Array<number> }`
   * to make saving variables easier.
   */
  public saveVar(name: string): this {
    let key = this.addNamedId(name);
    return this.addInstruction({
      PutLastInstructionOutputOnWorkspace: {
        key,
      },
    });
  }

  /**
   * Adds a fee instruction that calls the `take_fee` method on a component.
   * This method must exist and return a Bucket with containing revealed confidential XTR resource.
   * This allows the fee to originate from sources other than the transaction sender's account.
   * The fee instruction will lock up the `max_fee` amount for the duration of the transaction.
   */
  public feeTransactionPayFromComponent(componentAddress: ComponentAddress, maxFee: string): this {
    return this.addFeeInstruction({
      CallMethod: {
        call: {Address: componentAddress},
        method: "pay_fee",
        args: [maxFee],
      },
    });
  }

  /**
   * Adds a fee instruction that calls the `take_fee_confidential` method on a component.
   * This method must exist and return a Bucket with containing revealed confidential XTR resource.
   * This allows the fee to originate from sources other than the transaction sender's account.
   */
  public feeTransactionPayFromComponentConfidential(
    componentAddress: ComponentAddress,
    proof: ConfidentialWithdrawProof,
  ): this {
    return this.addFeeInstruction({
      CallMethod: {
        call: { Address:  componentAddress },
        method: "pay_fee_confidential",
        args: [proof],
      },
    });
  }

  public dropAllProofsInWorkspace(): this {
    return this.addInstruction("DropAllProofsInWorkspace");
  }

  public withUnsignedTransaction(unsignedTransaction: UnsignedTransactionV1): this {
    this.unsignedTransaction = unsignedTransaction;
    this.signatures = [];
    return this;
  }

  public withFeeInstructions(instructions: Instruction[]): this {
    this.unsignedTransaction.fee_instructions = instructions;
    this.signatures = [];
    return this;
  }

  public withFeeInstructionsBuilder(builder: (builder: TransactionBuilder) => TransactionBuilder): this {
    const newBuilder = builder(new TransactionBuilder(this.unsignedTransaction.network));
    this.unsignedTransaction.fee_instructions = newBuilder.unsignedTransaction.instructions;
    this.signatures = [];
    return this;
  }

  public addInstruction(instruction: Instruction): this {
    this.unsignedTransaction.instructions.push(instruction);
    this.signatures = [];
    return this;
  }

  public addFeeInstruction(instruction: Instruction): this {
    this.unsignedTransaction.fee_instructions.push(instruction);
    this.signatures = [];
    return this;
  }

  public withInstructions(instructions: Instruction[]): this {
    this.unsignedTransaction.instructions.push(...instructions);
    this.signatures = [];
    return this;
  }

  public addInput(inputObject: SubstateRequirement): this {
    this.unsignedTransaction.inputs.push(inputObject);
    this.signatures = [];
    return this;
  }

  public withInputs(inputs: SubstateRequirement[]): this {
    this.unsignedTransaction.inputs.push(...inputs);
    this.signatures = [];
    return this;
  }

  public withMinEpoch(minEpoch: number): this {
    this.unsignedTransaction.min_epoch = minEpoch;
    // Reset the signatures as they are no longer valid
    this.signatures = [];
    return this;
  }

  public withMaxEpoch(maxEpoch: number): this {
    this.unsignedTransaction.max_epoch = maxEpoch;
    // Reset the signatures as they are no longer valid
    this.signatures = [];
    return this;
  }

  public buildUnsignedTransaction(): UnsignedTransactionV1 {
    return this.unsignedTransaction;
  }

  public build(): Transaction {
    return new TransactionRequest(this.buildUnsignedTransaction(), this.signatures);
  }

  private addNamedId(name: string): number {
    const id = this.current_id;
    this.allocatedIds.set(name, id);
    this.current_id += 1;
    return id;
  }

  private getNamedId(name: string): number | undefined {
    return this.allocatedIds.get(name);
  }

  private getOffsetIdFromWorkspaceName(name: string): WorkspaceOffsetId {
    const parsed = parseWorkspaceStringKey(name);
    const id = this.getNamedId(parsed.name);
    if (id === undefined) {
      throw new Error(`No workspace with name ${parsed.name} found`);
    }
    return { id, offset: parsed.offset };
  }

  private resolveArgs(args: NamedArg[]): TransactionArg[] {
    return args.map((arg) => {
      if (typeof arg === "object" && "Workspace" in arg) {
        const workspaceId = this.getOffsetIdFromWorkspaceName(arg.Workspace);
        return { Workspace: workspaceId };
      }
      return arg;
    });
  }

}
