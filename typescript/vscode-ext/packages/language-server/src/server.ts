import {
  TextDocuments,
  Diagnostic,
  InitializeParams,
  InitializeResult,
  CodeActionKind,
  CodeActionParams,
  HoverParams,
  CompletionItem,
  CompletionParams,
  DeclarationParams,
  RenameParams,
  DocumentFormattingParams,
  DidChangeConfigurationNotification,
  Connection,
  DocumentSymbolParams,
  TextDocumentSyncKind,
} from 'vscode-languageserver'
import { debounce } from "ts-debounce";
import { createConnection, IPCMessageReader, IPCMessageWriter } from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'

import * as MessageHandler from './lib/MessageHandler'
import type { LSOptions, LSSettings } from './lib/types'
import { getVersion, getEnginesVersion, getCliVersion } from './lib/wasm/internals'
import { BamlDirCache } from './file/fileCache'
import { LinterInput } from './lib/wasm/lint'
import { cliBuild } from './baml-cli';

const packageJson = require('../../package.json') // eslint-disable-line
console.log('Server-side -- packageJson', packageJson)
function getConnection(options?: LSOptions): Connection {
  let connection = options?.connection
  if (!connection) {
    connection = process.argv.includes('--stdio')
      ? createConnection(process.stdin, process.stdout)
      : createConnection(new IPCMessageReader(process), new IPCMessageWriter(process))
  }
  return connection
}

let hasCodeActionLiteralsCapability = false
let hasConfigurationCapability = true

type BamlConfig = {
  path?: string;
  trace: {
    server: string;
  }
}
let config: BamlConfig | null = null;

/**
 * Starts the language server.
 *
 * @param options Options to customize behavior
 */
export function startServer(options?: LSOptions): void {
  console.log('Server-side -- startServer()')
  // Source code: https://github.com/microsoft/vscode-languageserver-node/blob/main/server/src/common/server.ts#L1044
  const connection: Connection = getConnection(options)

  console.log = connection.console.log.bind(connection.console)
  console.error = connection.console.error.bind(connection.console)


  console.log('Starting Baml Language Server...')

  const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)
  const bamlCache = new BamlDirCache();

  connection.onInitialize((params: InitializeParams) => {
    // Logging first...
    connection.console.info(`Default version of Prisma 'prisma-schema-wasm' : ${getVersion()}`)

    connection.console.info(
      // eslint-disable-next-line
      `Extension name ${packageJson?.name} with version ${packageJson?.version}`,
    )
    const prismaEnginesVersion = getEnginesVersion()
    // const prismaCliVersion = getCliVersion()
    // connection.console.info(`Prisma CLI v ersion: ${prismaCliVersion}`)

    // ... and then capabilities of the language server
    const capabilities = params.capabilities

    hasCodeActionLiteralsCapability = Boolean(capabilities?.textDocument?.codeAction?.codeActionLiteralSupport)
    hasConfigurationCapability = Boolean(capabilities?.workspace?.configuration)

    const result: InitializeResult = {
      capabilities: {
        definitionProvider: false,

        documentFormattingProvider: false,
        // completionProvider: {
        //   resolveProvider: false,
        //   triggerCharacters: ['@', '"', '.'],
        // },
        hoverProvider: false,
        renameProvider: false,
        documentSymbolProvider: false,
      },
    }

    // if (hasCodeActionLiteralsCapability) {
    //   result.capabilities.codeActionProvider = {
    //     codeActionKinds: [CodeActionKind.QuickFix],
    //   }
    // }

    return result
  })

  connection.onInitialized(() => {
    console.log('initialized')

    if (hasConfigurationCapability) {
      // Register for all configuration changes.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      connection.client.register(DidChangeConfigurationNotification.type)
      getConfig();
    }
  })

  // The global settings, used when the `workspace/configuration` request is not supported by the client or is not set by the user.
  // This does not apply to VS Code, as this client supports this setting.
  // const defaultSettings: LSSettings = {}
  // let globalSettings: LSSettings = defaultSettings // eslint-disable-line

  // Cache the settings of all open documents
  const documentSettings: Map<string, Thenable<LSSettings>> = new Map<string, Thenable<LSSettings>>()

  const getConfig = async () => {
    const configResponse = await connection.workspace.getConfiguration();
    config = configResponse["baml"] as BamlConfig;
    console.log("config " + JSON.stringify(config, null, 2));
  }

  connection.onDidChangeConfiguration((_change) => {
    connection.console.info('Configuration changed.' + JSON.stringify(_change, null, 2));
    getConfig();
    if (hasConfigurationCapability) {
      // Reset all cached document settings
      documentSettings.clear()
    } else {
      // globalSettings = <LSSettings>(change.settings.prisma || defaultSettings) // eslint-disable-line @typescript-eslint/no-unsafe-member-access
    }

    // Revalidate all open prisma schemas
    documents.all().forEach(validateTextDocument) // eslint-disable-line @typescript-eslint/no-misused-promises
  })

  documents.onDidOpen((e) => {
    try {
      // TODO: revalidate if something changed
      bamlCache.refreshDirectory(e.document);
      bamlCache.addDocument(e.document);
    } catch (e: any) {
      if (e instanceof Error) {
        console.log("Error opening doc" + e.message + " " + e.stack);
      } else {
        console.log("Error opening doc" + e);
      }
    }
  });

  // Only keep settings for open documents
  documents.onDidClose((e) => {
    try {
      bamlCache.refreshDirectory(e.document);
      // Revalidate all open files since this one may have been deleted.
      // we could be smarter and only do this if the doc was deleted, not just closed.
      documents.all().forEach(validateTextDocument)
      documentSettings.delete(e.document.uri)
    } catch (e: any) {
      if (e instanceof Error) {
        console.log("Error closing doc" + e.message + " " + e.stack);
      } else {
        console.log("Error closing doc" + e);
      }
    }
  })


  // function getDocumentSettings(resource: string): Thenable<LSSettings> {
  //   if (!hasConfigurationCapability) {
  //     connection.console.info(
  //       `hasConfigurationCapability === false. Defaults will be used.`,
  //     )
  //     return Promise.resolve(globalSettings)
  //   }

  //   let result = documentSettings.get(resource)
  //   if (!result) {
  //     result = connection.workspace.getConfiguration({
  //       scopeUri: resource,
  //       section: 'prisma',
  //     })
  //     documentSettings.set(resource, result)
  //   }
  //   return result
  // }

  // Note: VS Code strips newline characters from the message
  function showErrorToast(errorMessage: string): void {
    connection.window.showErrorMessage(errorMessage, {
      title: 'Show Details',
    }).then((item) => {
      if (item?.title === 'Show Details') {
        connection.sendNotification('baml/showLanguageServerOutput');
      }
    });
  }


  function validateTextDocument(textDocument: TextDocument) {
    try {
      const srcDocs = bamlCache.getDocuments(textDocument);
      const rootPath = bamlCache.getBamlDir(textDocument);
      if (!rootPath) {
        console.error("Could not find root path for " + textDocument.uri);
        return;
      }
      const linterInput: LinterInput = {
        root_path: rootPath,
        files: srcDocs.map((doc) => {
          return {
            path: doc.uri,
            content: doc.getText(),
          }
        }),
      }
      const diagnostics = MessageHandler.handleDiagnosticsRequest(documents, linterInput, showErrorToast);
      for (const [uri, diagnosticList] of diagnostics) {
        void connection.sendDiagnostics({ uri, diagnostics: diagnosticList });
      }
    } catch (e: any) {
      if (e instanceof Error) {
        console.log("Error validating doc" + e.message + " " + e.stack);
      } else {
        console.log("Error validating doc" + e);
      }
    }
  }

  const debouncedValidateTextDocument = debounce(validateTextDocument, 200, {
    isImmediate: true,
    maxWait: 2000,
  })

  documents.onDidChangeContent((change: { document: TextDocument }) => {
    debouncedValidateTextDocument(change.document);
  })

  documents.onDidSave((change: { document: TextDocument }) => {
    console.log("onDidSave " + change.document.uri);
    cliBuild(config?.path || "baml", bamlCache.getBamlDir(change.document), showErrorToast);
  })

  function getDocument(uri: string): TextDocument | undefined {
    return documents.get(uri)
  }

  // connection.onDefinition((params: DeclarationParams) => {
  //   const doc = getDocument(params.textDocument.uri)
  //   if (doc) {
  //     return MessageHandler.handleDefinitionRequest(doc, params)
  //   }
  // })

  // connection.onCompletion((params: CompletionParams) => {
  //   const doc = getDocument(params.textDocument.uri)
  //   if (doc) {
  //     return MessageHandler.handleCompletionRequest(params, doc, showErrorToast)
  //   }
  // })

  // This handler resolves additional information for the item selected in the completion list.
  // connection.onCompletionResolve((completionItem: CompletionItem) => {
  //   return MessageHandler.handleCompletionResolveRequest(completionItem)
  // })



  // connection.onHover((params: HoverParams) => {
  //   const doc = getDocument(params.textDocument.uri)
  //   if (doc) {
  //     return MessageHandler.handleHoverRequest(doc, params)
  //   }
  // })

  // connection.onDocumentFormatting((params: DocumentFormattingParams) => {
  //   const doc = getDocument(params.textDocument.uri)
  //   if (doc) {
  //     return MessageHandler.handleDocumentFormatting(params, doc, showErrorToast)
  //   }
  // })

  // connection.onCodeAction((params: CodeActionParams) => {
  //   const doc = getDocument(params.textDocument.uri)
  //   if (doc) {
  //     return MessageHandler.handleCodeActions(params, doc, showErrorToast)
  //   }
  // })

  // connection.onRenameRequest((params: RenameParams) => {
  //   const doc = getDocument(params.textDocument.uri)
  //   if (doc) {
  //     return MessageHandler.handleRenameRequest(params, doc)
  //   }
  // })

  // connection.onDocumentSymbol((params: DocumentSymbolParams) => {
  //   return [];
  //   // const doc = getDocument(params.textDocument.uri)
  //   // if (doc) {
  //   //   return MessageHandler.handleDocumentSymbol(params, doc)
  //   // }
  // })

  console.log('Server-side -- listening to connection')
  // Make the text document manager listen on the connection
  // for open, change and close text document events
  documents.listen(connection)

  connection.listen()
}
