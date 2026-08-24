// MIT License — Copyright (c) 2026 Mateus Gaio

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, buttonVariants } from "./button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import { Input } from "./input";
import {
  InputGroup,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./input-group";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover";
import { Progress } from "./progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable";
import { ScrollArea, ScrollBar } from "./scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select";
import { Skeleton } from "./skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants } from "./tabs";
import { Textarea } from "./textarea";

function markup(element: React.ReactElement) {
  return renderToStaticMarkup(element);
}

describe("primitivas shadcn (fundação U1)", () => {
  it("Button renderiza variantes e tamanhos", () => {
    const html = markup(
      <div>
        <Button>Enviar</Button>
        <Button variant="outline" size="sm">
          Cancelar
        </Button>
        <Button variant="ghost" size="icon" />
      </div>,
    );
    expect(html).toContain('data-slot="button"');
    expect(buttonVariants({ variant: "outline" })).toContain("border");
  });

  it("Input e Textarea renderizam", () => {
    expect(markup(<Input placeholder="modelo" />)).toContain("input");
    expect(markup(<Textarea />)).toContain("textarea");
  });

  it("InputGroup compõe input, texto e ações", () => {
    const html = markup(
      <InputGroup>
        <InputGroupText>@</InputGroupText>
        <InputGroupInput />
        <InputGroupButton>Ação</InputGroupButton>
        <InputGroupTextarea />
      </InputGroup>,
    );
    expect(html).toContain('data-slot="input-group"');
  });

  it("Skeleton renderiza", () => {
    expect(markup(<Skeleton />)).toContain("skeleton");
  });

  it("Progress aceita valor determinado", () => {
    expect(markup(<Progress value={42} />)).toContain("progressbar");
  });

  it("Tabs renderiza lista com trigger selecionado", () => {
    const html = markup(
      <Tabs defaultValue="chat">
        <TabsList>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="vault">Vault</TabsTrigger>
        </TabsList>
        <TabsContent value="chat">Conteúdo</TabsContent>
      </Tabs>,
    );
    expect(html).toContain("tabs");
    expect(html).toContain('data-state="active"');
    expect(tabsListVariants()).toBeTruthy();
  });

  it("Select renderiza gatilho com valor", () => {
    const html = markup(
      <Select defaultValue="gpt">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectScrollUpButton />
          <SelectGroup>
            <SelectLabel>Provedores</SelectLabel>
            <SelectItem value="gpt">GPT</SelectItem>
            <SelectSeparator />
            <SelectItem value="claude">Claude</SelectItem>
          </SelectGroup>
          <SelectScrollDownButton />
        </SelectContent>
      </Select>,
    );
    expect(html).toContain("select");
  });

  it("ScrollArea com ScrollBar renderiza", () => {
    const html = markup(
      <ScrollArea>
        Conteúdo longo
        <ScrollBar orientation="horizontal" />
      </ScrollArea>,
    );
    expect(html).toContain("scroll-area");
  });

  it("ResizablePanelGroup divide painéis", () => {
    const html = markup(
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel>Lado A</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel>Lado B</ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(html).toContain('data-slot="resizable-panel-group"');
  });

  it("Command renderiza lista completa", () => {
    const html = markup(
      <Command>
        <CommandInput placeholder="Buscar..." />
        <CommandList>
          <CommandEmpty>Nada encontrado.</CommandEmpty>
          <CommandGroup heading="Sugestões">
            <CommandItem>Novo chat</CommandItem>
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandGroup>
          <CommandSeparator />
        </CommandList>
      </Command>,
    );
    expect(html).toContain("command");
    expect(markup(<CommandDialog open />)).toBeDefined();
  });

  it("Dialog expõe gatilho e close; overlay/portal são client-only", () => {
    const html = markup(
      <Dialog>
        <DialogTrigger>Abrir</DialogTrigger>
        <DialogClose>Fechar</DialogClose>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Título</DialogTitle>
            <DialogDescription>Descrição</DialogDescription>
          </DialogHeader>
          <DialogFooter />
          <DialogPortal>
            <DialogOverlay />
          </DialogPortal>
        </DialogContent>
      </Dialog>,
    );
    expect(html).toContain("Abrir");
    expect(html).toContain("Fechar");
  });

  it("Popover expõe gatilho e âncora", () => {
    const html = markup(
      <Popover>
        <PopoverAnchor />
        <PopoverTrigger>Abrir menu</PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>Título</PopoverTitle>
            <PopoverDescription>Descrição</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>,
    );
    expect(html).toContain("Abrir menu");
  });
});
