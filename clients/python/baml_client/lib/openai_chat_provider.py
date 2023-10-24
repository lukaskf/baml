import openai
import typing

from .._impl.provider import (
    LLMChatMessage,
    LLMChatProvider,
    LLMResponse,
    register_llm_provider,
)


@register_llm_provider("openi-chat", "azure-chat")
@typing.final
class OpenAIChatProvider(LLMChatProvider):
    __kwargs: typing.Dict[str, typing.Any]

    def __init__(
        self, *, options: typing.Dict[str, typing.Any], **kwargs: typing.Any
    ) -> None:
        default_chat_role = kwargs.pop("default_chat_role", "user")
        assert default_chat_role is str, "default_chat_role must be a string"

        super().__init__(
            prompt_to_chat=lambda prompt: LLMChatMessage(
                role=default_chat_role, content=prompt
            ),
            **kwargs,
        )
        self.__kwargs = options

    async def _run_chat(self, messages: typing.List[LLMChatMessage]) -> LLMResponse:
        response = await openai.ChatCompletion.acreate(messages=messages, **self.__kwargs)  # type: ignore
        text = response["choices"][0]["text"]
        usage = response["usage"]
        model = response["model"]
        return LLMResponse(
            generated=text,
            model_name=model,
            meta=dict(
                logprobs=response["choices"][0]["logprobs"],
                prompt_tokens=usage.get("prompt_tokens", None),
                output_tokens=usage.get("completion_tokens", None),
                total_tokens=usage.get("total_tokens", None),
            ),
        )