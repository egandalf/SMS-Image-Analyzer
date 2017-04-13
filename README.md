# SMS Image Analyzer

This is the code for an SMS Service that I wrote for my Dad. See the related blog post.

I won't share the number or endpoint (can't afford massive hits...).

## SMS
This code uses Twilio for SMS/MMS handling. Messages are received using a Twilio phone number and passed via WebHook to my code.

## Hosting
The code is written to be hosted within an AWS Lambda Function. I set up an AWS API Gateway endpoint to serve as a simple passthrough for the POST data coming from Twilio. Twilio sends data as `x-www-form-urlencoded`, which Amazon's API Gateway doesn't like because it wants everything to match up with a JSON schema. So I switched it to a Lambda passthrough and I get the entire request as a JSON object and the request body as a string. Perfect!

## Image Analysis
I'm using Microsoft Cognitive Services Computer Vision API to analyze the image and to perform OCR for any text found. There is an "unofficial" NPM package here on GitHub, but the Computer Vision portion of it has some bad documentation and, even when corrected, returns 404s. I didn't dig into why, though I may do so at some point. For the time being, I've left the package referenced, but I'm using Fetch instead to make the requests to Microsoft.

If you give it a try on your own, please let me know! I'm [@egandalf](https://twitter.com/egandalf) on Twitter. Feel free to file any issues with the code here on GitHub.
