/*
 * Copyright 2024 gRPC authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  credentials,
  loadPackageDefinition,
  ResponderBuilder,
  Server,
  ServerCredentials,
  ServerInterceptingCall,
  ServerListenerBuilder,
  status,
} from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import parseArgs from "minimist";
import process from "node:process";

const PROTO_PATH = import.meta.dirname + "/../protos/echo.proto";

const packageDefinition = loadSync(
  PROTO_PATH,
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  },
);
const echoProto = loadPackageDefinition(packageDefinition).grpc.examples.echo;

function unaryEcho(call, callback) {
  console.log(`unary echoing message ${call.request.message}`);
  callback(null, call.request);
}

function bidirectionalStreamingEcho(call) {
  call.on("data", (request) => {
    console.log(`bidi echoing message ${request.message}`);
    call.write(request);
  });
  call.on("end", () => {
    call.end();
  });
}

const serviceImplementation = {
  unaryEcho,
  bidirectionalStreamingEcho,
};

function validateAuthorizationMetadata(metadata) {
  const authorization = metadata.get("authorization");
  if (authorization.length < 1) {
    return false;
  }
  return authorization[0] === "some-secret-token";
}

function authInterceptor(methodDescriptor, call) {
  const listener = (new ServerListenerBuilder())
    .withOnReceiveMetadata((metadata, next) => {
      if (validateAuthorizationMetadata(metadata)) {
        next(metadata);
      } else {
        call.sendStatus({
          code: status.UNAUTHENTICATED,
          details: "Auth metadata not correct",
        });
      }
    }).build();
  const responder = (new ResponderBuilder())
    .withStart((next) => {
      next(listener);
    }).build();
  return new ServerInterceptingCall(call, responder);
}

// logger is to mock a sophisticated logging system. To simplify the example, we just print out the content.
function logger(format, ...args) {
  console.log(`LOG (server):\t${format}\n`, ...args);
}

function loggingInterceptor(methodDescriptor, call) {
  const listener = new ServerListenerBuilder()
    .withOnReceiveMessage((message, next) => {
      logger(
        `Receive a message ${JSON.stringify(message)} at ${
          (new Date()).toISOString()
        }`,
      );
      next(message);
    }).build();
  const responder = new ResponderBuilder()
    .withStart((next) => {
      next(listener);
    })
    .withSendMessage((message, next) => {
      logger(
        `Send a message ${JSON.stringify(message)} at ${
          (new Date()).toISOString()
        }`,
      );
      next(message);
    }).build();
  return new ServerInterceptingCall(call, responder);
}

function main() {
  const argv = parseArgs(process.argv.slice(2), {
    string: "port",
    default: { port: "50051" },
  });
  const server = new Server({
    interceptors: [authInterceptor, loggingInterceptor],
  });
  server.addService(echoProto.Echo.service, serviceImplementation);
  server.bindAsync(
    `0.0.0.0:${argv.port}`,
    ServerCredentials.createInsecure(),
    (err, port) => {
      if (err != null) {
        return console.error(err);
      }
      console.log(`gRPC listening on ${port}`);
    },
  );
  let client = new echoProto.Echo(
    `localhost:${argv.port}`,
    credentials.createInsecure(),
  );
}

main();
