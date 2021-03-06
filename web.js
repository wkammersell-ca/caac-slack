var BLACKLISTED_FIELDS = [
	'VersionId',
	'In Progress Date',
	'Drag And Drop Rank',
	'Blocker',
	'Accepted Date'
];

var express = require('express');
var bodyParser = require('body-parser');
var https = require('https');
var pg = require('pg');


pg.defaults.ssl = true;
var app = express();
var jsonParser = bodyParser.json();
var urlParser = bodyParser.urlencoded();

// Set up RTM Client
var RtmClient = require( '@slack/client' ).RtmClient;
var WebClient = require( '@slack/client' ).WebClient;
var RTM_EVENTS = require( '@slack/client' ).RTM_EVENTS;
pg.connect( process.env.DATABASE_URL, function( err, client ) {
  	if ( err ) {
  		console.log("Error with DB: " + err );
  		return;
  	}
  	dbQuery = "SELECT bot_access_token FROM slack_teams WHERE slack_team_id = 'T1N5XSJVA';"; 
  	client.query( dbQuery ).on('row', function (row) {
  		var rowData = JSON.stringify(row);
  		var token = row.bot_access_token;
  		
  		var rtm = new RtmClient( token, {loglevel: 'debug'});
  		rtm.start();
  		
  		var slackWebClient = new WebClient( token );
  		
  		// Listen for messages to see if anyone references a work item
  		rtm.on(RTM_EVENTS.MESSAGE, function (message ) {
  			var pattern = /S\d*/;
  			var workItemId = pattern.exec( message.text );
  			if (workItemId !== null ) {
  				workItemId = workItemId[0];
  				var slackChannelId = message.channel;
  				
  				// Get the WSAPI API key
  				// TODO: How do we pick which API key to use if there are multiple projects?
  				dbQuery = "SELECT caac_api_key FROM caac_slack WHERE slack_channel_id = '" + slackChannelId + "';"; 
				client.query( dbQuery ).on('row', function (row) {
					var rowData = JSON.stringify(row);
					var apiKey = row.caac_api_key;
					
					// Query WSAPI for artifact
					var options = {
						hostname : 'rally1.rallydev.com' ,
						path  : '/slm/webservice/v2.0/artifact?query=(FormattedID%20%3D%20' + workItemId + ')',
						auth : apiKey + ':',
						method  : 'GET',
						headers : {
							'Content-type' : 'application/x-www-form-urlencoded; charset=utf-8'
						}
					};
					console.log('Query WSAPI for ' + workItemId );
					var req = https.request( options , resOAuth => {
						resOAuth.setEncoding( 'utf8' );
						var data = '';
						
    					resOAuth.on('data', (d) => {
    						data = data + d;
    					});
    					
    					resOAuth.on('end', () => {
    						data = JSON.parse(data);
    						
    						if ( data.QueryResult.TotalResultCount > 0 ) {
								var uuid = data.QueryResult.Results[0]._refObjectUUID;
								var link = data.QueryResult.Results[0]._ref;
								var name = data.QueryResult.Results[0]._refObjectName;
								
								var message = {
									"attachments" : [
										{
											"fallback" : " <" + link + "|" + workItemId + ':' + name + ">",
											"color" : 'black',
											"title" : workItemId + ": " + name,
											"callback_id" : "show_details",
											"title_link" : link,
											"actions" : [
												{
													"name" : "showdetails",
													"text" : "Show Details",
													"type" : "button",
													"value" : 'b7913f8d-d85d-4d75-8dc3-7b27776e1633' + '+' + uuid
												}
											]
										}
									]
								};
								
								console.log( 'Calling Slack Web Client' );
								slackWebClient.chat.postMessage( slackChannelId, '', message, (err, response) => {
									console.log(err);
									console.log(response);
								});
								//rtm.sendMessage( message, slackChannelId );
							} else {
								console.log( "Couldn't find " + workItemId + "." ); 
							}
						});
					});
					req.end();
				});
			}
		});
  	});
});

/* Test to process an incoming CAAC WebHook */
app.post('/caacnotify', jsonParser, function (req, res) {
	console.log( 'CAAC Callback starting...');	
	var action = req.body.message.action;
	var name = req.body.message.state["500a0d67-9c48-4145-920c-821033e4a832"].value;
	var displayColor = req.body.message.state["b0778de0-a927-11e2-9e96-0800200c9a66"].value;
	var formattedId = req.body.message.state["55c5512a-1518-4944-8597-3eb91875e8d1"].value;
	var scheduleState = req.body.message.state["aad205e0-2fbe-11e4-8c21-0800200c9a66"].value.name;
	var projectId = req.body.message.state['ae8ecc9f-b9a0-42a4-a6e3-c83d7f8a7070'].value.id;
	//var scheduleStateIndex = req.body.message.state["aad205e0-2fbe-11e4-8c21-0800200c9a66"].value.order_index;
	var detailLink = req.body.message.detail_link;
	var username = req.body.message.transaction.user.username;
	var userUuid = req.body.message.transaction.user.uuid;
	var timestamp = req.body.message.transaction.timestamp;
	var uuid = req.body.message.object_id;
	
	var changes = [];
	for ( var prop in req.body.message.changes ) {
		var field = req.body.message.changes[prop].display_name;
		if ( BLACKLISTED_FIELDS.indexOf( field ) == -1 ) {
			var newChange = {};
			newChange.title = req.body.message.changes[prop].display_name;
			
			var old_value = "";
			var new_value = "";
			if ( field == "Schedule State" ) {
				old_value = req.body.message.changes[prop].old_value.name;
				new_value = req.body.message.changes[prop].value.name;
				
				// Add some fun if the feature is accepted
				if ( new_value == 'Accepted' ) {
					var celebrations = [
						':smiley:',
						':smile:',
						':upside_down_face:',
						':sunglasses:',
						':smiley_cat:',
						':smile_cat:',
						':clap:',
						':balloon:',
						':cake:'
					];
					for (var i = 0; i < 3; i ++ ) {
						new_value = new_value + celebrations[Math.floor(Math.random() * celebrations.length)];
					}
				}
			} else if ( field == "Plan Estimate" ) {
				old_value = req.body.message.changes[prop].old_value;
				if ( old_value !== null ) { old_value = old_value.value; }
				new_value = req.body.message.changes[prop].value;
				if ( new_value !== null ) { new_value = new_value.value; }
			} else if ( field == "Owner" ) {
				old_value = req.body.message.changes[prop].old_value;
				if ( old_value !== null ) { old_value = old_value.name; }
				new_value = req.body.message.changes[prop].value;
				if ( new_value !== null ) { new_value = new_value.name; }
			} else {
				old_value = req.body.message.changes[prop].old_value;
				new_value = req.body.message.changes[prop].value;
			}
			
			newChange.value = old_value + ' ➜ ' + new_value;
			newChange.short = false;
			changes.push(newChange);
		} else {
			console.log( 'Ignored ' + field );
		}
	};
	
	if ( changes.length == 0 ) {
		console.log('No relevant changes were found.');
		res.end();
		return;
	};
	
	// Look up the relevant Slack webhook
	var webhookUrl = '';
	pg.connect( process.env.DATABASE_URL, function( err, client ) {
  		if ( err ) {
  			console.log("Error with DB: " + err );
  			return;
  		}
  		dbQuery = "SELECT slack_incoming_webhook FROM slack_incoming_webhooks WHERE slack_channel_id = 'C1N5XSP36';"; 
  		client.query( dbQuery ).on('row', function (row) {
  			var rowData = JSON.stringify(row);
  			webhookUrl = row.slack_incoming_webhook;
  			
			var options = {
				hostname : 'hooks.slack.com' ,
				path : webhookUrl.replace( 'https://hooks.slack.com', '' ),
				method : 'POST'
			};
			
			//Create data for action to move forward.
			nextScheduleStateAction = null;
			if ( scheduleState != 'Released' ) {
				nextScheduleStateAction = {};
				nextScheduleStateAction.type = "button";
				nextScheduleStateAction.value = projectId + '+' + uuid;
				switch( scheduleState ) {
					case 'Idea':
						nextScheduleStateAction.name = "movetodefined";
						nextScheduleStateAction.text = "Move to Defined";
						break;
					case 'Defined':
						nextScheduleStateAction.name = "movetoinprogress";
						nextScheduleStateAction.text = "Move to In Progress";
						break;
					case 'In-Progress':
						nextScheduleStateAction.name = "movetocompleted";
						nextScheduleStateAction.text = "Move to Completed";
						break;
					case 'Completed':
						nextScheduleStateAction.name = "movetoaccepted";
						nextScheduleStateAction.text = "Move to Accepted";
						break;
					case 'Accepted':
						nextScheduleStateAction.name = "movetoreleased";
						nextScheduleStateAction.text = "Move to Released";
						break;
				}
			}
						
			var payload = {
				"attachments" : [
					{
						"fallback" : action + " <" + detailLink + "|" + formattedId + "> " + name,
						"color" : displayColor,
						"author_name" : username,
						"title" : formattedId + ": " + name,
						"title_link" : detailLink,
						"fields" : changes,
						"callback_id" : "caac_notify",
						// "ts" : timestamp -- This seems to give issues with a date in the past in Slack
						"actions" : [
							{
								"name" : "assigntome",
								"text" : "Assign to Me",
								"type" : "button",
								"value" : projectId + '+' + uuid
							},
							nextScheduleStateAction
						]
					}
				]
			};

			var req = https.request( options , function (res , b , c) {
			} );

			req.on( 'error' , function (e) {
				console.log( 'problem with request: ' + e.message );
			} );

			req.write( JSON.stringify( payload ) );
			req.end();
			res.end();
		} );
  	} );
});

/* Endpoint for Slack button interactivity */
app.post('/slack/buttonaction', urlParser, function (req, resSuper) {
	console.log('Slack Button Action starting...');
	
	var payload = JSON.parse( req.body.payload );
	console.log(payload);
	
	// Fetch Slack Team
	var slackChannelId = payload.channel.id;
	var caacProjectId = payload.actions[0].value.split('+')[0];
	var caacUuid = payload.actions[0].value.split('+')[1];
	var responseUrl = payload.response_url;
	var originalMessage = payload.original_message;
	var slackUserName = payload.user.name;
	var slackToken = payload.token;
	
	// Confirm this call is coming from Slack
	if ( slackToken == null || slackToken != process.env.SLACK_VERIFICATION_TOKEN ) {
		console.log("This call does not seem to be coming from Slack");
		resSuper.status(403).end();
		return;
	}
		
	pg.connect( process.env.DATABASE_URL, function( err, client ) {
		if ( err ) {
			console.log("Error with DB: " + err );
			return;
		}
		console.log('Connected to DB');
	
		dbQuery = "SELECT caac_api_key FROM caac_slack WHERE slack_channel_id = '" + slackChannelId + "' AND caac_project_id = '" + caacProjectId + "';"; 
		console.log( dbQuery );
		client.query( dbQuery ).on('row', function (row) {
			var rowData = JSON.stringify(row);
			var apiKey = row.caac_api_key;
			
			var actionText = '';
			var updateJson = {};
			updateJson.HierarchicalRequirement = {};
			
			console.log(payload);
			
			if ( payload.actions[0].name == 'showdetails' ) {
				// Query WSAPI for artifact
				var options = {
					hostname : 'rally1.rallydev.com' ,
					path  : '/slm/webservice/v2.0/hierarchicalrequirement/' + caacUuid,
					auth : apiKey + ':',
					method  : 'GET',
				//	headers : {
				//		'Content-type' : 'application/x-www-form-urlencoded; charset=utf-8'
				//	}
				};
				
				console.log( options );
				console.log( 'Getting WSAPI story details' );
				var reqDetails = https.request( options , resDetails => {
					console.log( 'Processing response...');
					resDetails.setEncoding( 'utf8' );
					var data = '';
					
					resDetails.on('data', (d) => {
						data = data + d;
					});
					
					resDetails.on('end', () => {
						console.log ('Response Done!');
						data = JSON.parse(data);
						var displayColor = data.HierarchicalRequirement.DisplayColor;
						var scheduleState = data.HierarchicalRequirement.ScheduleState;
						var owner = data.HierarchicalRequirement.Owner._refObjectName;
						var planEstimate = data.HierarchicalRequirement.PlanEstimate;
						
						originalMessage.attachments[0].color = displayColor;
						originalMessage.attachments[0].fields = [
							{
								"title" : "Schedule State",
								"value" : scheduleState
							},
							{
								"title" : "Owner",
								"value" : owner
							},
							{
								"title" : "Plan Estimate",
								"value" : planEstimate
							}
						];
						
						//Create data for action to move forward.
						nextScheduleStateAction = null;
						if ( scheduleState != 'Released' ) {
							nextScheduleStateAction = {};
							nextScheduleStateAction.type = "button";
							nextScheduleStateAction.value = caacProjectId + '+' + caacUuid;
							switch( scheduleState ) {
								case 'Idea':
									nextScheduleStateAction.name = "movetodefined";
									nextScheduleStateAction.text = "Move to Defined";
									break;
								case 'Defined':
									nextScheduleStateAction.name = "movetoinprogress";
									nextScheduleStateAction.text = "Move to In Progress";
									break;
								case 'In-Progress':
									nextScheduleStateAction.name = "movetocompleted";
									nextScheduleStateAction.text = "Move to Completed";
									break;
								case 'Completed':
									nextScheduleStateAction.name = "movetoaccepted";
									nextScheduleStateAction.text = "Move to Accepted";
									break;
								case 'Accepted':
									nextScheduleStateAction.name = "movetoreleased";
									nextScheduleStateAction.text = "Move to Released";
									break;
							}
						}
						
						originalMessage.attachments[0].actions = [
							{
								"name" : "assigntome",
								"text" : "Assign to Me",
								"type" : "button",
								"value" : caacProjectId + '+' + caacUuid
							},
							nextScheduleStateAction
						];
						
						console.log("Sending Results");
						console.log( originalMessage );
						resSuper.setHeader('Content-Type', 'application/json; charset=utf-8');
						resSuper.send( JSON.stringify( originalMessage ) );
					});
				} );
				
				reqDetails.on( 'error' , function (e) {
   					console.log( 'problem with request: ' + e.message );
				} );
				reqDetails.end();
			} else {
				switch( payload.actions[0].name ) {
					case 'assigntome':
						break;
					case 'movetodefined':
						updateJson.HierarchicalRequirement.ScheduleState = 'Defined';
						actionText = 'moved to Defined';
						break;
					case 'movetoinprogress':
						updateJson.HierarchicalRequirement.ScheduleState = 'In-Progress';
						actionText = 'moved to In Progress';
						break;
					case 'movetocompleted':
						updateJson.HierarchicalRequirement.ScheduleState = 'Completed';
						actionText = 'moved to Completed';
						break;
					case 'movetoaccepted':
						updateJson.HierarchicalRequirement.ScheduleState = 'Accepted';
						actionText = 'moved to Accepted';
						break;
					case 'movetoreleased':
						updateJson.HierarchicalRequirement.ScheduleState = 'Released';
						actionText = 'moved to Released';
						break;
				}

				var options = {
					hostname : 'rally1.rallydev.com' ,
					path  : '/slm/webservice/v2.0/hierarchicalrequirement/' +
							caacUuid,
					method  : 'POST',
					headers : {
						'Content-type' : 'text/json; charset=utf-8'
					},
					auth : apiKey + ':'
				};
	
				// Making update to CAAC
				console.log( 'Making update to CAAC...' );
				var req = https.request( options , res => {
					res.setEncoding( 'utf8' );
					res.on('data', (d) => {
					//	console.log( d );
					});
				} );

				req.on( 'error' , function (e) {
					console.log( 'problem with request: ' + e.message );
				} );

				req.write( JSON.stringify( updateJson ) );
				req.end();
			
				resSuper.setHeader('Content-Type', 'application/json; charset=utf-8');
				originalMessage.attachments[0].actions = [];
				originalMessage.attachments[0].fields.push( {
					"title" : ":white_check_mark: " + slackUserName + " " + actionText + "."
				} );
				resSuper.send( JSON.stringify( originalMessage ) );
			}
		});
	});
});

/* Endpoint for Slack in the OAuth flow */
app.get('/slackauth', jsonParser, function (req, res) {
	console.log('Slack Auth starting...');
	
	var temporaryCode = req.query.code;
	console.log('Received temporary code');
	
	var options = {
	    hostname : 'slack.com' ,
	    path  : '/api/oauth.access?client_id=' +
	    		process.env.SLACK_CLIENT_ID +
	    		'&client_secret=' + 
	    		process.env.SLACK_CLIENT_SECRET +
	    		'&code=' +
	    		temporaryCode +
	    		'&redirect_uri=' +
	    		encodeURIComponent( "https://lower-donair-82094.herokuapp.com/slackauth" ),
	    method  : 'GET',
	    headers : {
	    	'Content-type' : 'application/x-www-form-urlencoded; charset=utf-8'
	    }
	};
	
	var req = https.request( options , resOAuth => {
		console.log("Response from Slack on OAuth");
		
		var teamId = '';
		var teamName = '';
		var channelId = '';
		var channelName = '';
		var webhookUrl = '';
		
    	resOAuth.setEncoding( 'utf8' );
    	resOAuth.on('data', (d) => {
    		console.log(d);
    		var data = JSON.parse(d);
    		if ( data.ok == false ) {
    			console.log("Error with Slack Response: " + d);
    			return;
    		}
    		teamId = data.team_id;
    		teamName = data.team_name;
    		channelId = data.incoming_webhook.channel_id;
    		channelName = data.incoming_webhook.channel;
    		webhookUrl = data.incoming_webhook.url;

	  		// Save info to Database
  			pg.connect( process.env.DATABASE_URL, function( err, client ) {
  				if ( err ) {
  					console.log("Error with DB: " + err );
  					return;
  				}
  				console.log('Connected to DB');
  				
  				console.log('Adding Slack Team to DB');
  				var dbQuery = "INSERT INTO slack_teams ( slack_team_id, slack_team_name) VALUES ('" + teamId + "','" + teamName + "');";
  				client.query( dbQuery );
  				
  				console.log('Adding Slack Webhook to DB');
  				dbQuery = "INSERT INTO slack_incoming_webhooks ( slack_channel_id, slack_channel_name, slack_team_id, slack_incoming_webhook ) VALUES ('" + channelId + "','" + channelName + "','" + teamId + "','" + webhookUrl + "');"; 
  				client.query( dbQuery );
  			} );
  			console.log( 'Slack Credentials added to DB');
  		} );
  	} );
	
	req.on( 'error' , function (e) {
   		console.log( 'problem with request: ' + e.message );
	} );

	req.end();
	
	console.log('Slack Auth done...');
	res.end();
});

var port = process.env.PORT || 5000;
app.listen(port, function() {
	console.log( "Listening on " + port);
});