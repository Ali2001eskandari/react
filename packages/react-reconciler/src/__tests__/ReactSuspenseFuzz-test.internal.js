let React;
let ReactTestRenderer;
let ReactFeatureFlags;
let originalConsoleError;

const prettyFormatPkg = require('pretty-format');

function prettyFormat(thing) {
  return prettyFormatPkg(thing, {
    plugins: [
      prettyFormatPkg.plugins.ReactElement,
      prettyFormatPkg.plugins.ReactTestComponent,
    ],
  });
}

describe('ReactSuspenseFuzz', () => {
  beforeEach(() => {
    jest.resetModules();
    ReactFeatureFlags = require('shared/ReactFeatureFlags');
    ReactFeatureFlags.debugRenderPhaseSideEffectsForStrictMode = false;
    ReactFeatureFlags.replayFailedUnitOfWorkWithInvokeGuardedCallback = false;
    ReactFeatureFlags.enableHooks = true;
    React = require('react');
    ReactTestRenderer = require('react-test-renderer');

    originalConsoleError = console.error;
    console.error = (msg, ...rest) => {
      if (msg.includes('update on an unmounted component')) {
        // Suppress this warning. I think my components are correct, but there's
        // this thing with Jest timers where if you advance time, then clear a
        // timeout in one of the affected timers, but that timer was already
        // about to fire, it doesn't clear. Regardless, if this warning fires it
        // doesn't affect the correctness of the thing we're actually testing.
        return;
      }
      originalConsoleError(msg, ...rest);
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  function createFuzzer() {
    const {Suspense, useState, useLayoutEffect} = React;

    let shouldSuspend;
    let pendingTasks;
    let cache;

    function Container({children, updates}) {
      const [step, setStep] = useState(0);

      useLayoutEffect(
        () => {
          if (updates !== undefined) {
            const cleanUps = new Set();
            updates.forEach(({remountAfter}, i) => {
              const task = {
                label: `Remount childen after ${remountAfter}ms`,
              };
              const timeoutID = setTimeout(() => {
                pendingTasks.delete(task);
                setStep(i + 1);
              }, remountAfter);
              pendingTasks.add(task);
              cleanUps.add(() => {
                pendingTasks.delete(task);
                clearTimeout(timeoutID);
              });
            });
            return () => {
              cleanUps.forEach(cleanUp => cleanUp());
            };
          }
        },
        [updates],
      );

      return <React.Fragment key={step}>{children}</React.Fragment>;
    }

    function Text({text, initialDelay, updates}) {
      const [[step, delay], setStep] = useState([0, initialDelay]);

      useLayoutEffect(
        () => {
          if (updates !== undefined) {
            const cleanUps = new Set();
            updates.forEach(({beginAfter, suspendFor}, i) => {
              const task = {
                label: `Update ${beginAfter}ms after mount and suspend for ${suspendFor}ms`,
              };
              const timeoutID = setTimeout(() => {
                pendingTasks.delete(task);
                setStep([i + 1, suspendFor]);
              }, beginAfter);
              pendingTasks.add(task);
              cleanUps.add(() => {
                pendingTasks.delete(task);
                clearTimeout(timeoutID);
              });
            });
            return () => {
              cleanUps.forEach(cleanUp => cleanUp());
            };
          }
        },
        [updates],
      );

      const fullText = updates === undefined ? text : `${text} [${step}]`;

      if (shouldSuspend) {
        const resolvedText = cache.get(fullText);
        if (resolvedText === undefined) {
          const thenable = {
            then(resolve) {
              const task = {label: `Suspended ${resolvedText}]`};
              pendingTasks.add(task);
              setTimeout(() => {
                cache.set(fullText, fullText);
                pendingTasks.delete(task);
                resolve();
              }, delay);
            },
          };
          cache.set(fullText, thenable);
          throw thenable;
        } else if (resolvedText.then === 'function') {
          const thenable = resolvedText;
          throw thenable;
        }
      }

      return fullText;
    }

    function renderToRoot(root, children) {
      pendingTasks = new Set();
      cache = new Map();

      root.update(children);
      root.unstable_flushAll();

      let elapsedTime = 0;
      while (pendingTasks && pendingTasks.size > 0) {
        if ((elapsedTime += 10) > 1000000) {
          throw new Error('Something did not resolve properly.');
        }
        jest.advanceTimersByTime(10);
        root.unstable_flushAll();
      }

      return root.toJSON();
    }

    function testResolvedOutput(unwrappedChildren) {
      const children = (
        <Suspense fallback="Loading...">{unwrappedChildren}</Suspense>
      );

      shouldSuspend = false;
      const expectedRoot = ReactTestRenderer.create(null);
      const expectedOutput = renderToRoot(expectedRoot, children);

      shouldSuspend = true;
      const syncRoot = ReactTestRenderer.create(null);
      const syncOutput = renderToRoot(syncRoot, children);
      expect(syncOutput).toEqual(expectedOutput);

      const concurrentRoot = ReactTestRenderer.create(null, {
        unstable_isConcurrent: true,
      });
      const concurrentOutput = renderToRoot(concurrentRoot, children);
      expect(concurrentOutput).toEqual(expectedOutput);
    }

    function pickRandomWeighted(options) {
      let totalWeight = 0;
      for (let i = 0; i < options.length; i++) {
        totalWeight += options[i].weight;
      }
      const randomNumber = Math.random() * totalWeight;
      let remainingWeight = randomNumber;
      for (let i = 0; i < options.length; i++) {
        const {value, weight} = options[i];
        remainingWeight -= weight;
        if (remainingWeight <= 0) {
          return value;
        }
      }
    }

    function randomInteger(min, max) {
      min = Math.ceil(min);
      max = Math.floor(max);
      return Math.floor(Math.random() * (max - min)) + min;
    }

    function generateTestCase(numberOfElements) {
      let remainingElements = numberOfElements;

      function createRandomChild(hasSibling) {
        const possibleActions = [
          {value: 'return', weight: 1},
          {value: 'text', weight: 1},
        ];

        if (hasSibling) {
          possibleActions.push({value: 'container', weight: 1});
          possibleActions.push({value: 'suspense', weight: 1});
        }

        const action = pickRandomWeighted(possibleActions);

        switch (action) {
          case 'text': {
            remainingElements--;

            const numberOfUpdates = pickRandomWeighted([
              {value: 0, weight: 8},
              {value: 1, weight: 4},
              {value: 2, weight: 1},
            ]);

            let updates = [];
            for (let i = 0; i < numberOfUpdates; i++) {
              updates.push({
                beginAfter: randomInteger(0, 10000),
                suspendFor: randomInteger(0, 10000),
              });
            }

            return (
              <Text
                text={(remainingElements + 9).toString(36).toUpperCase()}
                initialDelay={randomInteger(0, 10000)}
                updates={updates}
              />
            );
          }
          case 'container': {
            const numberOfUpdates = pickRandomWeighted([
              {value: 0, weight: 8},
              {value: 1, weight: 4},
              {value: 2, weight: 1},
            ]);

            let updates = [];
            for (let i = 0; i < numberOfUpdates; i++) {
              updates.push({
                remountAfter: randomInteger(0, 10000),
              });
            }

            remainingElements--;
            const children = createRandomChildren(3);
            return React.createElement(Container, {updates}, ...children);
          }
          case 'suspense': {
            remainingElements--;
            const children = createRandomChildren(3);

            const maxDuration = pickRandomWeighted([
              {value: undefined, weight: 1},
              {value: randomInteger(0, 5000), weight: 1},
            ]);

            return React.createElement(Suspense, {maxDuration}, ...children);
          }
          case 'return':
          default:
            return null;
        }
      }

      function createRandomChildren(limit) {
        const children = [];
        while (remainingElements > 0 && children.length < limit) {
          children.push(createRandomChild(children.length > 0));
        }
        return children;
      }

      const children = createRandomChildren(Infinity);
      return React.createElement(React.Fragment, null, ...children);
    }

    return {Container, Text, testResolvedOutput, generateTestCase};
  }

  it('basic cases', () => {
    const {Container, Text, testResolvedOutput} = createFuzzer();
    testResolvedOutput(
      <Container updates={[{remountAfter: 150}]}>
        <Text
          text="Hi"
          initialDelay={2000}
          updates={[{beginAfter: 100, suspendFor: 200}]}
        />
      </Container>,
    );
  });

  it('generative tests', () => {
    const {generateTestCase, testResolvedOutput} = createFuzzer();

    const NUMBER_OF_TEST_CASES = 500;
    const ELEMENTS_PER_CASE = 8;

    for (let i = 0; i < NUMBER_OF_TEST_CASES; i++) {
      const randomTestCase = generateTestCase(ELEMENTS_PER_CASE);
      try {
        testResolvedOutput(randomTestCase);
      } catch (e) {
        console.log(`
Failed fuzzy test case:

${prettyFormat(randomTestCase)}
`);

        throw e;
      }
    }
  });
});
