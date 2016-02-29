"use strict";
const expect = require("expect.js");
const request = require("request");
const url = require("url");
const sqlite3 = require('sqlite3');
const Server = require("../src/server");

// GET the protocol response from the server started for local testing
function req(route, cb) {
    request("http://localhost:48444" + route, (error, response, body) => {
        if (error) {
            return cb(error);
        }
        expect(response.headers["content-type"]).to.match(/application\/json;?.*/);
        try {
            response.body = JSON.parse(body);
        } catch(e) {
            return cb(new Error("Invalid JSON response: " + body));
        }
        cb(null, response);
    });
}

describe("Server", function() {
    let server = null;
    before(function(_) {
        let db = new sqlite3.Database(__dirname + '/test.db');
        server = Server.Start({port: 48444, db: db}, _);
        server.on("response", (request) => {
            if (request.response.statusCode === 500) {
                console.dir(request.response.source);
            }
        });
    });

    describe("nonexistent route", function() {
        it("should return NotFound", function(_) {
            let res = req("/bogus", _);
            expect(res.statusCode).to.be(404);
            expect(res.body.error.type).to.be("NotFound");
        });
    });

    describe("bam", function() {
        it("should report NotFound for a nonexistent item", function(_) {
            let res = req("/ENCODE/ENC123456/bam", _);
            expect(res.statusCode).to.be(404);
            expect(res.body.error.type).to.be("NotFound");
        });

        it("should serve the URL for a BAM", function(_) {
            let res = req("/ENCODE/ENCFF621SXE/bam", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.url).to.be.a('string');
        });

        it("should serve the URL and byte range for a genomic range slice", function(_) {
            let res = req("/htsnexus_test/NA12878/bam?range=20:6000000-6020000", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.url).to.be.a('string');
            expect(res.body.reference).to.be('GRCh37');

            expect(res.body.prefix).to.be.a('string');
            let buf = new Buffer(res.body.prefix, 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);

            expect(res.body.byteRange.start).to.be(977196);
            expect(res.body.byteRange.end).to.be(1165273);
            expect(res.body.httpRequestHeaders.range).to.be('bytes=977196-1165272');

            expect(res.body.suffix).to.be.a('string');
            buf = new Buffer(res.body.suffix, 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);

            res = req("/htsnexus_test/NA12878/bam?range=20:5000000-6020000", _);
            expect(res.body.httpRequestHeaders.range).to.be('bytes=977196-1165272');
        });

        it("should suppress BAM header slice prefix on request", function(_) {
            let res = req("/htsnexus_test/NA12878/bam?range=20:6000000-6020000&noHeaderPrefix", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.url).to.be.a('string');
            expect(res.body.reference).to.be('GRCh37');
            expect(res.body.httpRequestHeaders.range).to.be('bytes=977196-1165272');
            expect(res.body.prefix).to.be(undefined);
        });

        it("should serve the byte range for a whole reference sequence", function(_) {
            let res = req("/htsnexus_test/NA12878/bam?range=20", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.url).to.be.a('string');
            expect(res.body.reference).to.be('GRCh37');
            expect(res.body.httpRequestHeaders.range).to.be('bytes=977196-2128165');

            expect(res.body.prefix).to.be.a('string');
            let buf = new Buffer(res.body.prefix, 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);

            expect(res.body.suffix).to.be.a('string');
            buf = new Buffer(res.body.suffix, 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
        });

        it("should serve the byte range for unmapped reads", function(_) {
            let res = req("/htsnexus_test/NA12878/bam?range=*", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.url).to.be.a('string');
            expect(res.body.reference).to.be('GRCh37');
            expect(res.body.httpRequestHeaders.range).to.be('bytes=2112141-2596770');

            expect(res.body.prefix).to.be.a('string');
            let buf = new Buffer(res.body.prefix, 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);

            expect(res.body.suffix).to.be.a('string');
            buf = new Buffer(res.body.suffix, 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);
        });

        it("should serve empty result sets", function(_) {
            let res = req("/htsnexus_test/NA12878/bam?range=20:1-10000", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.byteRange).to.be(null);

            expect(res.body.prefix).to.be.a('string');
            let buf = new Buffer(res.body.prefix, 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);

            expect(res.body.suffix).to.be.a('string');
            buf = new Buffer(res.body.suffix, 'base64');
            expect(buf[0]).to.be(0x1f);
            expect(buf[1]).to.be(0x8b);
            expect(buf.length).to.be(28);

            res = req("/htsnexus_test/NA12878/bam?range=XXX", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.byteRange).to.be(null);
        });

        it("should reject invalid ranges", function(_) {
            expect(req("/htsnexus_test/NA12878/bam?range=:1-2", _).statusCode).to.be(422);
            expect(req("/htsnexus_test/NA12878/bam?range=$:1-2", _).statusCode).to.be(422);
        });

        it("should report Unable to range-query an unindexed BAM", function(_) {
            let res = req("/ENCODE/ENCFF621SXE/bam?range=1", _);
            expect(res.statusCode).to.be(406);
        });

        it("should redirect to Heng Li's bamsvr", function(_) {
            let res = req("/lh3bamsvr/EXA00001/bam", _);
            expect(res.statusCode).to.be(200);

            res = req("/lh3bamsvr/EXA00001/bam?range=11:10899000-10900000", _);
            expect(res.statusCode).to.be(200);
            expect(res.body.prefix).to.be(undefined);
            expect(res.body.byteRange).to.be(undefined);
            expect(res.body.suffix).to.be(undefined);
        });
    });

    after(function(_) {
        if (server) {
            server.stop({timeout: 1000}, _);
        }
    });
});
