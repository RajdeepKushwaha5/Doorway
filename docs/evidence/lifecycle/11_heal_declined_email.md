# Bright Data's reply to the heal request

Received 24 August 2026, roughly twelve minutes after the heal in
[`09_heal.txt`](09_heal.txt) reported `status: error`. Quoted in full and
unedited.

> Hi,
>
> Thank you for submitting you code refactoring request.
> Unfortunately, we were unable to generate working code for the changes you
> requested.
> This can occur due to various reasons, such as dynamic content,
> authentication requirements, or unsupported page structure.
>
> We appreciate your understanding and are here to help.

## What was actually asked for

The prompt named the field and the correct source, which is the pattern Bright
Data's own support engineer described as intended:

> The deadline_raw field returns the early-interest date. Re-capture it from
> the Application deadline line.

## What the page looked like

The relevant part of [`05_page_broken.html`](05_page_broken.html) is a
definition list holding two dates:

```html
<dt>Early interest deadline</dt>  <dd class="deadline">1 September 2026</dd>
<dt>Application deadline</dt>     <dd class="real-deadline">18 September 2026</dd>
```

The correct value is in an element with a unique class, `real-deadline`,
present in the served HTML. There is no authentication. The fix was expressible
as a single class selector.

## What we can and cannot conclude

**What is verifiable from the files here:** the heal was requested with a
specific prompt naming the field and its correct source, Bright Data reported
`status: error` after `planner` and `control_preview_runner`, and this email
followed. The value it was asked to capture was in static markup under a unique
class.

**What we are not claiming:** that any of the three reasons in the email is
wrong. The fixture is a server-rendered Next.js page, so it does ship hydration
scripts, and a heuristic could reasonably classify it as dynamic. We also
cannot see what the healer generated or why its own preview step failed. The
email does not say which of the three applied, and we are not going to guess on
its behalf.

**Why it is here anyway:** the heal in this chain failed, and a reader deserves
the platform's own account of why rather than ours. It also happens to sit
close to the argument this project makes. What the prompt asked for was
"re-capture it from the Application deadline line", which is a request phrased
in terms of a label. Selectors do not read labels. That gap is the reason there
is a second, selector-free sensor in this system at all.
