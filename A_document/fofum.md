
fofum - wasmbin type-map and honor system

previous idea discussion output:

Yes. That architecture is practical, and your security goal makes sense: you're not trying to make extraction impossible; you're trying to make casual copying substantially less convenient than simply saving the image, while making deliberate extraction/patching an obvious act.

A plausible pipeline is:

                 opaque image.wasm
                ┌─────────────────┐
                │                 │
Original image ─► embedded image  │
                │                 │
                │ transformation  │
                │ provenance      │
                │ PNG encoder     │
                └────────┬────────┘
                         │
                         │ instantiate
                         ▼
                     Browser
                         │
              ┌──────────┴──────────┐
              │                     │
          server nonce          user/session
              │                     │
              └──────────┬──────────┘
                         ▼
                  WASM algorithm
                         │
                         ▼
                   generated PNG
                         │
                         ▼
                  Blob / Object URL
                         │
                         ▼
                     <img>

You don't necessarily need the JSON layer. You could have a tiny JS bootstrapper that:

Downloads the .wasm.
Instantiates it.
Requests a nonce/token from your API.
Passes the nonce + relevant parameters to Wasm.
Wasm reconstructs/transforms the embedded image.
Wasm produces PNG bytes.
JS creates a Blob.
JS assigns URL.createObjectURL(blob) to the <img>.
Something like:

const wasm = await WebAssembly.instantiateStreaming(
    fetch("/asset.wasm")
);

const nonce = await fetch("/api/nonce").then(r => r.arrayBuffer());

const pngPtr = wasm.instance.exports.generate(
    /* nonce, user/session information, etc. */
);

const png = /* obtain bytes from WASM memory */;

const blob = new Blob([png], { type: "image/png" });
img.src = URL.createObjectURL(blob);

The 1–2 second target is realistic
For a relatively small image, the actual image processing could be much faster than that. The biggest contributors may actually be:

downloading the Wasm
downloading the nonce/auth information
Wasm initialization
PNG encoding
network latency
Once the module is cached, subsequent executions could potentially be very quick.

And you don't necessarily need a giant Wasm runtime. A purpose-built module containing the image + transformation + PNG encoder could potentially be quite compact.

One design I'd strongly consider
Instead of putting a complete conventional PNG encoder in the module, you could make the Wasm produce RGBA pixel data, then have a small JS-side encoder/library produce the PNG.

But if your goal is specifically to make the image harder to extract, having the PNG construction itself inside Wasm makes the artifact less straightforward to inspect.

For example:

Wasm memory
│
├── encrypted/encoded image representation
├── temporary working buffer
├── transformed pixels
└── PNG output
          │
          ▼
       JS Blob

You could also arrange things so the original representation isn't simply sitting in memory as a recognizable PNG/JPEG. That's useful because otherwise someone could just search the .wasm for a recognizable image header or extract the embedded asset.

Your provenance layer can make this considerably more interesting
For example:

server nonce
       +
asset ID
       +
user/session information
       +
secret server-derived value
       ↓
    WASM algorithm
       ↓
 image transformation
       +
provenance signal
       ↓
 generated PNG

The server could retain enough information to later establish:

"This particular rendered image was generated for asset X under provenance token Y."

That gives you something stronger than merely hiding the source image.

One caveat: don't put the actual secret server-derived value inside the Wasm permanently. If it's embedded in the .wasm, someone can eventually extract it. Have the server provide per-request material instead.

And your threat model is actually favorable
You're essentially saying:

"I don't care if a sufficiently motivated reverse engineer can defeat this. I care that downloading image.png from DevTools isn't enough, and that defeating the system requires deliberately analyzing/patching the executable."

For that objective, Wasm is a pretty reasonable fit.

Someone who wants the pristine original would have to start doing things like:

download WASM
     ↓
inspect binary
     ↓
locate image representation
     ↓
understand reconstruction
     ↓
bypass nonce/provenance logic
     ↓
extract/reconstruct original

rather than:

Right click → Save Image

That's a meaningful difference.

One particularly nice property is that the normal DOM only gets the derived PNG. The source asset doesn't appear as a normal network resource, <img> URL, or straightforward image file. The user can of course still screenshot/capture the rendered result, but that's exactly the tradeoff you're describing.

If the images are reasonably small, I'd consider this a very viable design for a "rendered asset, not directly downloadable source asset" system.