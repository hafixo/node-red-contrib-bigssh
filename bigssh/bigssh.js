/**
 * Copyright 2013, 2015 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Original and good work by IBM
 * "Big Nodes" mods by Jacques W
 *
 * /\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\
 *
 *  Big Nodes principles:
 *
 *  #1 can handle big data
 *  #2 send start/end messages
 *  #3 tell what they are doing
 *
 *  Any issues? https://github.com/Jacques44
 *
 * /\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\/\
 *
 **/

module.exports = function(RED) {

    "use strict";

    var biglib = require('node-red-biglib');
    var stream = require('stream');

    function SSH_Node(n) {

      RED.nodes.createNode(this, n);

      this.host = n.host;
      this.port = n.port;
      this.label = '';
      this.userlabel = n.userlabel;

      var ssh_config = {
        host: this.host,
        port: this.port,
        username: this.credentials.username,
        privateKey: undefined,
        privateKeyFile: this.credentials.privateKey
      }

      //
      // In order to make this an instance while the object is common, it must not have any access to this.
      // execute must be called in the context of the node using these credentials
      //
      this.execute = function(my_config) {

        // Choice was made to read the keyfile at each run in order to make it possible to correct a configuration
        // without restarting
        try {
          ssh_config.privateKey = require('fs').readFileSync(ssh_config.privateKeyFile);
        } catch (err) {
          throw new Error("Private Key: " + err.Message);
        }

        // Create 3 passthrough in order to return a full set of streams far before they are really connected to a valid ssh remote command
        var stdin  = new stream.PassThrough({ objectMode: true }); // acts as a buffer while ssh is connecting
        var stdout = new stream.PassThrough({ objectMode: true });
        var ret = require('event-stream').duplex(stdin, stdout);

        var stderr = new stream.PassThrough({ objectMode: true });

        // the others property is known by biglib and used to send extra streams to extra outputs
        ret.others = [ stderr ];

        // Here it is, the job is starting now
        var conn = new require('ssh2').Client();

        // this means "biglib"
        this.working("Connecting to " + ssh_config.host + "...");

        conn.on('ready', function() {

          var commandLine = my_config.commandLine + ' ' + ((my_config.commandArgs || []).map(function(x) { return x.replace(' ', '\\ ') })).join(' ');

          // this means biglib
          this.working("Executing " + commandLine.substr(0,20) + "...");

          conn.exec(commandLine, function(err, stream) {
            if (err) return ret.emit('error', err);

            this.working('Launched, waiting for data...');

            stream
              .on('close', function(code, signal) {  

                // Gives biglib extra informations using the "stats" function                        
                this.stats({ rc: code, signal: signal });              
              }.bind(this))
              .on('error', function(err) {
                ret.emit('error', err);
              })

            // SSH stream is available, connect the bufstream
            stdin.pipe(stream).pipe(stdout);

            // Also connect the ssh stderr stream to the pre allocated stderr 
            stream.stderr.pipe(stderr);

          }.bind(this));      

        }.bind(this))
        .on('error', function(err) {
          ret.emit('error', err);
        })
        .connect(ssh_config)

        return ret;
      }

    }

    RED.nodes.registerType("SSH_Credentials", SSH_Node, {
      credentials: {
        username: { type: "text" },
        privateKey: { type: "text" }
      }
    });      

    const ssh_options = {
      "commandLine": "",
      "commandArgs": [],
      "minError": 1  
    }    

    function BigSSH(config) {

      RED.nodes.createNode(this, config);
      this.myssh = config.myssh;

      var crednode = RED.nodes.getNode(config.myssh);

      // Custom on_finish callback used to correct the node status relative to the command return code
      var my_finish = function(stats) {        
        if (stats.rc >= config.minError) this.set_error(new Error("Return code " + stats.rc));        
      };

      // new instance of biglib for this configuration
      var bignode = new biglib({ 
        config: config, node: this,   // biglib needs to know the node configuration and the node itself (for statuses and sends)
        status: 'filesize',           // define the kind of informations displayed while running
        parser_config: ssh_options,   // the parser configuration (ie the known options the parser will understand)
        parser: crednode.execute,     // the parser (ie the remote command)
        on_finish: my_finish          // custom on_finish handler
      });

      // biglib changes the configuration to add some properties
      config = bignode.config();

      this.on('input', bignode.main.bind(bignode));
    }  

    RED.nodes.registerType("bigssh", BigSSH);

}
