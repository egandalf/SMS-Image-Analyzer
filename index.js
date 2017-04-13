const AWS = require('aws-sdk'); // for decrypting environment variables
const EventEmitter = require('events').EventEmitter;
const Promise = require('promise');
const qs = require('querystring'); // for parsing x-www-form-urlencoded data into json
const twilio = require('twilio'); // works great!
const cognitiveServices = require('cognitive-services'); // works NOT AT ALL! :(
const fetch = require('node-fetch'); // using this to manually work with MS Cog Services since their package isn't working for now.

const awsApiGatewayAddress = process.env['serviceUrl']; // the URL configured for Twilio's messaging webhook; I don't care if this is encrypted

// Get encrypted environment variables
const msCogEncrypted = process.env['msCogServicesKey1'];
const twilioAuthTokenEncrypted = process.env['twilioAuthToken'];

// event emitter used for timing when decryption is completed as well as when to send the message(s).
var ee = new EventEmitter();

// for storing unencrypted values
let msCogKey1;
let twilioAuthToken;

// The main function of the app.
function processEvent(event, context, callback) {
    // using a session variable in order to retain session-based context for processing status and the message object.
    var session = {};

    // parse the x-www-form-urlencoded data from the body of the POST
    session.params = qs.parse(event.body);
    // get the twilio signature for validation
    session.twilioSignature = event.headers["X-Twilio-Signature"];
    
    // validate request originated from Twilio
    if(session.twilioSignature && twilio.validateRequest(twilioAuthToken, session.twilioSignature, awsApiGatewayAddress, session.params)){
        // booleans for determining when each service is completed, will be reset to false with each request
        session.performedAnalysis = false;
        session.performedOCR = false;
        
        // response may contain multiple messages (one for each MS Cog Service employed).
        session.message = new twilio.TwimlResponse();

        // check twilio request has a media object...
        if(!session.params.NumMedia || isNaN(session.params.NumMedia) || session.params.NumMedia == 0){
            session.message.message("The message sent did not contain any media.");
            callback(null, {
                "statusCode" : 200,
                "headers" : {
                    "Content-Type" : "text/xml"
                },
                "body" : session.message.toString()
            });
        } else {
            ee.on('message', sendMessage);
            performAnalysis(session, callback);
            performOCR(session, callback);
        }
    } else {
        callback("Request did not originate from SMS.", {
            "statusCode" : 500,
            "headers" : {},
            "body" : ""
        });
    }
}

function performAnalysis(session, callback){
    // doing a manual request due to the node package not working correctly
    fetch('https://api.projectoxford.ai/vision/v1.0/analyze?visualFeatures=Description&language=en', {
        method: 'POST',
        body: JSON.stringify({ "url" : session.params.MediaUrl0 }), // only supporting a single image per request
        headers: {
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key' : msCogKey1
        }
    }).then(res => {
        return res.json();
    }).then(body => {
        // success!
        var text = body.description.captions[0].text;
        var conf = Math.round(body.description.captions[0].confidence * 100);
        session.message.message("I am " + conf + " percent confident that this image can be described as " + text);
        
        // inform the messaging system that this analysis has been performed.
        session.performedAnalysis = true;
        ee.emit('message', session, callback);
    }).catch(err => {
        // friendly error feedback. error is logged.
        console.log(err);
        session.message.message("Sorry. I was not able to analyze this media.");
        callback(null, {
            "statusCode" : 200,
            "headers" : {
                "Content-Type": "text/xml"
            },
            "body": session.message.toString()
        }); 
    });
}

function performOCR(session, callback){
    fetch('https://api.projectoxford.ai/vision/v1.0/ocr', {
        method: 'POST',
        body: JSON.stringify({ "url" : session.params.MediaUrl0 }),
        headers: {
            'Content-Type' : 'application/json',
            'Ocp-Apim-Subscription-Key' : msCogKey1
        }
    }).then(res => {
        return res.json();
    }).then(body => {
        // success!
        // validate there are regions (found text) to be sent back
        if(body.regions && body.regions.length > 0){
            var ocr = "Image Text:\n";
            // loops through the multi-level JSON response and assembles regions/lines into a string response.
            Promise.all(body.regions.map(parseRegion)).done((text) => {
                ocr += text;
                session.message.message(ocr);
                session.performedOCR = true;
                ee.emit('message', session, callback);
            });
        } else {
            // no additional message if there's no text detected
            session.performedOCR = true;
            ee.emit('message', session, callback);
        }
    }).catch(err => { 
        // not worring about responding to this. not every image contains text.
        console.log(err); 
        session.performedOCR = true; 
        ee.emit('message', session, callback); 
    });
}

function parseRegion(region){
    return new Promise((fulfill, reject) => {
        let regionText = '';
        Promise.all(region.lines.map(parseLine)).done((lines) => {
            regionText = lines.join('\n\n');
            fulfill(regionText);
        });
    });
}

function parseLine (line){
    return new Promise((fulfill, reject) => {
        let lineText = '';
        Promise.all(line.words.map(parseWord)).done((words) => {
            lineText = words.join(' ');
            fulfill(lineText);
        });
    });
}

function parseWord (word) {
    return new Promise((fulfill, reject) => {
        fulfill(word.text);
    });
}

function sendMessage(session, callback) {
    // validates all processing is completed
    if(session.performedAnalysis && session.performedOCR){
        // send response back to Twilio
        callback(null, {
            "statusCode" : 200,
            "headers" : {
                "Content-Type": "text/xml"
            },
            "body": session.message.toString()
        }); 
    }
}

// Amazon call handler
exports.handler = (event, context, callback) => {
    // if decryption is done, no need to repeat it
    if(msCogKey1 && twilioAuthToken){
        processEvent(event, context, callback);
    } else {
        // decrypt values from environment variables
        ee.on('decrypted', function() {
            if(msCogKey1 && twilioAuthToken){
                // clean-up emitter
                ee.removeAllListeners('decrypted');
                processEvent(event, context, callback);
            }
        });
        decryptValue(msCogEncrypted, (err, value) => {
            msCogKey1 = value;
            ee.emit('decrypted');
        });
        decryptValue(twilioAuthTokenEncrypted, (err, value) => {
            twilioAuthToken = value;
            ee.emit('decrypted');
        });
    }
};

function decryptValue(encrypted, callback)
{
    const kms = new AWS.KMS();
    kms.decrypt({ CiphertextBlob: new Buffer(encrypted, 'base64') }, (err, data) => {
        if (err) {
            console.log('Decrypt error:', err);
            callback(err);
        }
        callback(null, data.Plaintext.toString('ascii'));
    });
}