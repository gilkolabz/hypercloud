this document expresses the devops style of the foobarch/navi framework

this framework can be used to service businesses that need not be aware of anything we have built for foobarch/navi, and the final product may have a UX that entirely obscures our build pattern and appears totally standard.

if we are creating a production level solution for business use:
we may expose api via the foobarch proposal system and/or
deliver a PWA experience via a non-root foobarch browser shell

it is not immediately clear the degree of js will be used, this has to be decided:
whether it be a more classically restful MPA with routed html
or a js heavy UX
nevertheless, we can depend on navi runtime and the foobarch HTMX shell pattern (see [foobarch/README.md](../foobarch/README.md))

we will likely use:
https://foobarch.net = this hosts foobarch dispatch server and is our canonical origin (see [foobarch/README.md](foobarch/README.md) for details)
/flowerpot — is a live proposal at foobarch that hosts all static data versioned (see [flowerpot/README.md](../flowerpot/README.md))

flowerpot will host raw data, schematics, templates, and modules

See [navi_modules_guide.md](navi_modules_guide.md) for the full navi modules specification.

we don't have a readme yet for the navi runtime itself, but here is the source code for navi_shell runtime — see [foobarch/static/navi_shell.js](../foobarch/static/navi_shell.js)

when we work on a new project aka business level implementation:
for now, we have yet to dogfood entirely into foobarch, and we are still using this local IDE where u are reading this most likely.
therefore, create a subfolder under the directory in hypercloud called A_devops. this is the folder: [A_devops](../A_devops)
with a name that matches the goal we are working with
within this subfolder, we will be placing all of our artifacts
create a readme.md for this project, and create a devguide.md

devguide.md will basically describe the entire pipe that is involved conceptually for what we are building, so we will constantly update it describing the stack (roughly):
foobarch.net
navi_shell
golang server
data files (json?)
templates
styling
animations
navi modules

we would only justify the use of golang and hosting a server if we are doing operations that are outside of the abilities of the servers i have already introduced, basically u must make decisions based on what is available and is least bloating, everything is perfectly extensible and limitless, but we must prevent redundancy, DRY is law for our design.

we want to stay modular as well, so that each functionality can be incrementally improved on by devops in the future, basically following the spirit of the UNIX Philosophy:
Write programs that do one thing and do it well.
Write programs to work together.
Write programs to handle text streams, because that is a universal interface.
Ofcourse here programs would be navi modules and text streams would be the emission system of navi_shell.
it follows that all abilities affordances and operations could be completed programmatically, and UI/UX is an embellishment of presentation over a robust underlying logic/data planning

always attempt to seek standardization, as we are actively developing foobarch/navi ecosystem and we are discovering new ways to standardize what we already built to interoperate better.

I expect the devguide to also effectively articulate a clear reasoning for WHY decisions are made, so that we can understand where misalignments arise. it is essential that we do not lose this reasoning and that is why we have a seperate document. Attach these citations below the critical items so that we do not effect the speed of readability of varying concerns.

thank you

further notes:

UX exists on a spectrum of programmatic soundness -- presentation richness, where we extend out of programmatic soundness into increasingly enhanced presentation.
this progression should be easily modularly divided and connected for modular devops design.