import type { PatternResponseV7 } from "@patternlike/shared";
import type { PortraitObjectBinding } from "../lib/pattern-portrait.js";
import image1 from "./references/native-01.png?url";
import image2 from "./references/native-02.png?url";
import image3 from "./references/native-03.png?url";
import image4 from "./references/native-04.png?url";

/** Authored fictional chapters; each image was generated from only its own complete chapter through ChatGPT-authenticated Codex. */
export const nativePattern: PatternResponseV7 = {
  "schema_version": "0.7.0",
  "pattern_id": "pat_fictional_native_portrait_20260905",
  "generated_at": "2026-09-05T18:00:00Z",
  "locale": "en-US",
  "effective_accuracy": "exact",
  "provenance": {
    "assembly_mode": "constrained_model",
    "provider": "Fictional preview",
    "model_family": "Authored sample",
    "raw_birth_details_sent": false
  },
  "core_chapters": [
    {
      "title": "Finding your own direction",
      "summary": "You can choose a direction before every part of the journey is clear.",
      "sections": [
        {
          "text": "There may be moments when several sensible paths are available and none carries a guarantee. Another person's certainty can be reassuring, but it cannot tell you which direction feels consistent with what matters to you."
        },
        {
          "text": "You can begin by naming one value you want the next choice to serve. A small step can provide information that thinking in circles cannot. You are allowed to notice what you learn and adjust your course."
        }
      ],
      "tensions": [
        {
          "text": "Looking for an unmistakable sign can delay a choice that is already small enough to explore."
        }
      ],
      "resources": [
        {
          "text": "You can distinguish a change of direction from a loss of purpose. The value can remain steady while the route changes."
        }
      ],
      "counter_expression": {
        "text": "Sometimes choosing your direction means listening carefully to advice and then deciding which part belongs with you."
      }
    },
    {
      "title": "Making room for care",
      "summary": "Care becomes easier to receive when there is room for your needs alongside someone else's.",
      "sections": [
        {
          "text": "You may recognize another person's needs quickly and make space for them before checking your own capacity. That responsiveness can be generous. It becomes easier to sustain when your own hunger, rest, and limits also have a place."
        },
        {
          "text": "A small, specific offer can carry more warmth than a promise that leaves you depleted. You can ask what would be useful, say what you can give, and allow someone else to care for you in return."
        }
      ],
      "tensions": [
        {
          "text": "Being needed can feel close to being valued, even when the exchange leaves little room for you."
        }
      ],
      "resources": [
        {
          "text": "You can offer care in a form that is simple, practical, and possible to repeat without exhausting yourself."
        }
      ],
      "counter_expression": {
        "text": "Receiving something without immediately returning the favor can also be an act of trust."
      }
    },
    {
      "title": "Keeping what matters",
      "summary": "A dependable commitment can steady you while other parts of life change.",
      "sections": [
        {
          "text": "You do not need every circumstance to stay the same in order to feel grounded. One dependable promise, relationship, or practice can provide enough stability to consider something new."
        },
        {
          "text": "It can help to separate the commitment itself from the form it has taken. You may keep what matters while loosening an arrangement that no longer serves it. Holding on thoughtfully includes knowing when to release some weight."
        }
      ],
      "tensions": [
        {
          "text": "Familiar responsibility can become difficult to question when carrying it has become part of how you understand yourself."
        }
      ],
      "resources": [
        {
          "text": "You can make a commitment concrete and give it a realistic place in daily life."
        }
      ],
      "counter_expression": {
        "text": "Staying connected to what matters can sometimes require a deliberate departure from what is familiar."
      }
    },
    {
      "title": "Seeing beyond the immediate",
      "summary": "A wider perspective can make room for possibilities that today's pressure hides.",
      "sections": [
        {
          "text": "An urgent question can fill your attention until it seems to be the whole landscape. Taking a little distance may reveal that the present difficulty is one part of a longer story."
        },
        {
          "text": "You can look further ahead without demanding a prediction. A question about the life you want to be moving toward may help you choose what deserves attention today. Curiosity can give the future room to surprise you."
        }
      ],
      "tensions": [
        {
          "text": "Imagining a distant possibility can become a way to postpone a small action that is available now."
        }
      ],
      "resources": [
        {
          "text": "You can move between detail and perspective, using each to correct what the other leaves out."
        }
      ],
      "counter_expression": {
        "text": "Sometimes the wider view makes a modest, ordinary next step feel sufficient."
      }
    }
  ],
  "additional_signatures": [],
  "uncertainty": null
};

export const nativeImageBindings: readonly PortraitObjectBinding[] = [
  {
    "documentRevision": "0.7.0:pat_fictional_native_portrait_20260905:2026-09-05T18:00:00Z",
    "chapterId": "chapter-1",
    "sourceText": "{\"title\":\"Finding your own direction\",\"summary\":\"You can choose a direction before every part of the journey is clear.\",\"sections\":[\"There may be moments when several sensible paths are available and none carries a guarantee. Another person's certainty can be reassuring, but it cannot tell you which direction feels consistent with what matters to you.\",\"You can begin by naming one value you want the next choice to serve. A small step can provide information that thinking in circles cannot. You are allowed to notice what you learn and adjust your course.\"],\"tensions\":[\"Looking for an unmistakable sign can delay a choice that is already small enough to explore.\"],\"resources\":[\"You can distinguish a change of direction from a loss of purpose. The value can remain steady while the route changes.\"],\"counterExpression\":\"Sometimes choosing your direction means listening carefully to advice and then deciding which part belongs with you.\"}",
    "object": {
      "label": "Adjustable brass compass",
      "rationale": "Its steady blue needle represents a guiding value, while the movable nested rings suggest exploring and revising the route without losing purpose.",
      "referenceId": "chatgpt-native-study/chapter-1",
      "referenceSha256": "b3d92f0cc0bc17a1e4546fc3d080752d8cba493211319412d7f2fbf9d2f72d32",
      "imageUrl": image1
    }
  },
  {
    "documentRevision": "0.7.0:pat_fictional_native_portrait_20260905:2026-09-05T18:00:00Z",
    "chapterId": "chapter-2",
    "sourceText": "{\"title\":\"Making room for care\",\"summary\":\"Care becomes easier to receive when there is room for your needs alongside someone else's.\",\"sections\":[\"You may recognize another person's needs quickly and make space for them before checking your own capacity. That responsiveness can be generous. It becomes easier to sustain when your own hunger, rest, and limits also have a place.\",\"A small, specific offer can carry more warmth than a promise that leaves you depleted. You can ask what would be useful, say what you can give, and allow someone else to care for you in return.\"],\"tensions\":[\"Being needed can feel close to being valued, even when the exchange leaves little room for you.\"],\"resources\":[\"You can offer care in a form that is simple, practical, and possible to repeat without exhausting yourself.\"],\"counterExpression\":\"Receiving something without immediately returning the favor can also be an act of trust.\"}",
    "object": {
      "label": "Two-seat wooden rocking bench",
      "rationale": "Its two equally supported places make room for another person and oneself, while the steady rocking form evokes practical, sustainable care and the trust of receiving rest.",
      "referenceId": "chatgpt-native-study/chapter-2",
      "referenceSha256": "c8cf5e25dd1f1a27318abd05460bbed1506f5e358d0bee74bb3f3ad63c220b66",
      "imageUrl": image2
    }
  },
  {
    "documentRevision": "0.7.0:pat_fictional_native_portrait_20260905:2026-09-05T18:00:00Z",
    "chapterId": "chapter-3",
    "sourceText": "{\"title\":\"Keeping what matters\",\"summary\":\"A dependable commitment can steady you while other parts of life change.\",\"sections\":[\"You do not need every circumstance to stay the same in order to feel grounded. One dependable promise, relationship, or practice can provide enough stability to consider something new.\",\"It can help to separate the commitment itself from the form it has taken. You may keep what matters while loosening an arrangement that no longer serves it. Holding on thoughtfully includes knowing when to release some weight.\"],\"tensions\":[\"Familiar responsibility can become difficult to question when carrying it has become part of how you understand yourself.\"],\"resources\":[\"You can make a commitment concrete and give it a realistic place in daily life.\"],\"counterExpression\":\"Staying connected to what matters can sometimes require a deliberate departure from what is familiar.\"}",
    "object": {
      "label": "Knotted coil of rope",
      "rationale": "The firm loop embodies a dependable commitment, while the weighted coil loosens into a free path—keeping what matters while deliberately releasing a familiar form.",
      "referenceId": "chatgpt-native-study/chapter-3",
      "referenceSha256": "562ddb34401e55bece80eac4c554574f463a87fcef7aec89c29f6f1e1e1bcfd1",
      "imageUrl": image3
    }
  },
  {
    "documentRevision": "0.7.0:pat_fictional_native_portrait_20260905:2026-09-05T18:00:00Z",
    "chapterId": "chapter-4",
    "sourceText": "{\"title\":\"Seeing beyond the immediate\",\"summary\":\"A wider perspective can make room for possibilities that today's pressure hides.\",\"sections\":[\"An urgent question can fill your attention until it seems to be the whole landscape. Taking a little distance may reveal that the present difficulty is one part of a longer story.\",\"You can look further ahead without demanding a prediction. A question about the life you want to be moving toward may help you choose what deserves attention today. Curiosity can give the future room to surprise you.\"],\"tensions\":[\"Imagining a distant possibility can become a way to postpone a small action that is available now.\"],\"resources\":[\"You can move between detail and perspective, using each to correct what the other leaves out.\"],\"counterExpression\":\"Sometimes the wider view makes a modest, ordinary next step feel sufficient.\"}",
    "object": {
      "label": "Collapsible brass spyglass",
      "rationale": "Its adjustable sections embody moving between immediate detail and a longer view, while its compact, practical form suggests that perspective should support—not postpone—the next modest action.",
      "referenceId": "chatgpt-native-study/chapter-4",
      "referenceSha256": "f916b2a4b3ed5e6f1fd77d775370ce1a630ee18964357e9597ac1c0fe3134036",
      "imageUrl": image4
    }
  }
];
