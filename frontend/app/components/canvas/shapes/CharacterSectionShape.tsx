import { useState } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type Geometry2d,
  type RecordProps,
} from "tldraw";
import { type CharacterSectionShape } from "./types";
import {
  SparklesIcon,
  PencilIcon,
  ArrowPathIcon,
  TrashIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { getStaticUrl } from "~/services/api";
import type { Character } from "~/types";
import { canvasEvents } from "../canvasEvents";

export class CharacterSectionShapeUtil extends ShapeUtil<CharacterSectionShape> {
  static override type = "character-section" as const;

  static override props: RecordProps<CharacterSectionShape> = {
    w: T.number,
    h: T.number,
    characters: T.any,
  };

  getDefaultProps(): CharacterSectionShape["props"] {
    return {
      w: 800,
      h: 400,
      characters: [],
    };
  }

  override canEdit() {
    return false;
  }

  override canResize() {
    return false;
  }

  override hideSelectionBoundsFg() {
    return true;
  }

  override hideSelectionBoundsBg() {
    return true;
  }

  getGeometry(shape: CharacterSectionShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  component(shape: CharacterSectionShape) {
    const { characters } = shape.props;

    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: "all",
        }}
        className="h-full"
      >
        <CharacterSectionContent characters={characters} />
      </HTMLContainer>
    );
  }

  indicator() {
    return null;
  }
}

function CharacterCard({ character }: { character: Character }) {
  const [isHovered, setIsHovered] = useState(false);
  const imageUrl = getStaticUrl(character.image_url);

  const handleEdit = () => {
    canvasEvents.emit("edit-character", character);
  };

  const handleRegenerate = () => {
    canvasEvents.emit("regenerate-character", character.id);
  };

  const handleDelete = () => {
    canvasEvents.emit("delete-character", character);
  };

  const handlePreview = () => {
    if (imageUrl) {
      canvasEvents.emit("preview-image", { src: imageUrl, alt: character.name });
    }
  };

  return (
    <div
      className="bg-base-200 rounded-lg p-3 relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 操作栏 */}
      <div
        className={`absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg bg-base-100/90 p-1 backdrop-blur-sm transition-all duration-200 ${
          isHovered ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          className="btn btn-xs btn-circle btn-ghost text-base-content"
          onClick={(e) => { e.stopPropagation(); handleEdit(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title="编辑"
        >
          <PencilIcon className="w-3.5 h-3.5" />
        </button>
        <button
          className="btn btn-xs btn-circle btn-secondary"
          onClick={(e) => { e.stopPropagation(); handleRegenerate(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title="重新生成"
        >
          <ArrowPathIcon className="w-3.5 h-3.5" />
        </button>
        <button
          className="btn btn-xs btn-circle btn-error"
          onClick={(e) => { e.stopPropagation(); handleDelete(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title="删除"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 角色信息 */}
      <div className="flex items-start gap-2 mb-2">
        <h4 className="font-bold text-base-content flex-1">{character.name}</h4>
      </div>
      {character.description && (
        <p className="text-xs text-base-content/70 mb-3 line-clamp-2">
          {character.description}
        </p>
      )}

      {/* 角色图片 */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={character.name}
          className="w-full h-48 object-cover rounded-lg cursor-zoom-in hover:opacity-90 transition-opacity"
          onClick={handlePreview}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="w-full h-48 bg-base-300 rounded-lg flex items-center justify-center">
          <UserIcon className="w-12 h-12 text-base-content/20" />
        </div>
      )}
    </div>
  );
}

function CharacterSectionContent({ characters }: { characters: Character[] }) {
  return (
    <div className="card-doodle bg-base-100 p-5 h-full">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center">
          <SparklesIcon className="w-4 h-4 text-warning" />
        </div>
        <h2 className="text-lg font-heading font-bold text-base-content">角色设计师</h2>
      </div>

      {/* 角色网格 */}
      {characters.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          {characters.map((char) => (
            <CharacterCard key={char.id} character={char} />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-base-content/50">
          <UserIcon className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">等待角色图生成...</p>
        </div>
      )}
    </div>
  );
}
